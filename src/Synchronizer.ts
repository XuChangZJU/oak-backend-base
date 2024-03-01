import { EntityDict, StorageSchema, EndpointItem, RemotePullInfo, SelfEncryptInfo, 
    RemotePushInfo, PushEntityDef, PullEntityDef, SyncConfig } from 'oak-domain/lib/types';
import { VolatileTrigger } from 'oak-domain/lib/types/Trigger';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { destructRelationPath, destructDirectPath } from 'oak-domain/lib/utils/relationPath';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import assert from 'assert';
import { join } from 'path';
import { difference } from 'oak-domain/lib/utils/lodash';
import { getRelevantIds } from 'oak-domain/lib/store/filter';

const OAK_SYNC_HEADER_ENTITY = 'oak-sync-entity';
const OAK_SYNC_HEADER_ENTITYID = 'oak-sync-entity-id';

type Channel<ED extends EntityDict & BaseEntityDict> = {
    queue: Array<{
        resolve: () => void;
        reject: (err: any) => void;
        oper: Partial<ED['oper']['Schema']>;
    }>;            // 要推送的oper队列
    api: string;                                            // 推送的api
    nextPushTimestamp?: number;                             // 下一次推送的时间戳
    handler?: ReturnType<typeof setTimeout>;                // 推送定时器
};

export default class Synchronizer<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    private config: SyncConfig<ED, Cxt>;
    private schema: StorageSchema<ED>;
    private selfEncryptInfo?: SelfEncryptInfo;
    private remotePullInfoMap: Record<string, Record<string, {
        pullInfo: RemotePullInfo,
        pullEntityDict: Record<string, PullEntityDef<ED, keyof ED, Cxt>>;
    }>> = {};
    private pullMaxBornAtMap: Record<string, number> = {};

    private remotePushChannel: Record<string, Channel<ED>> = {};

    /**
     * 向某一个远端对象push opers。根据幂等性，这里如果失败了必须反复推送
     * @param channel 
     * @param retry 
     */
    private async pushOnChannel(remoteEntity: keyof ED, remoteEntityId: string, context: Cxt, channel: Channel<ED>, retry?: number) {
        const { queue, api, nextPushTimestamp } = channel;
        assert(nextPushTimestamp);

        // 失败重试的间隔，失败次数多了应当适当延长，最多延长到1024秒
        let nextPushTimestamp2 = typeof retry === 'number' ? Math.pow(2, Math.min(retry, 10)) : 1;
        channel.nextPushTimestamp = nextPushTimestamp2 * 1000 + Date.now();

        const opers = queue.map(ele => ele.oper);

        let restOpers = [] as typeof queue;
        let needRetry = false;
        let json: {
            successIds: string[], failed: {
                id: string;
                error: string;
            }
        };
        try {
            // todo 加密
            const selfEncryptInfo = await this.getSelfEncryptInfo(context);
            console.log('向远端结点sync数据', api, JSON.stringify(opers));
            const finalApi = join(api, selfEncryptInfo.id);
            const res = await fetch(finalApi, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json',
                    [OAK_SYNC_HEADER_ENTITY]: remoteEntity as string,
                    [OAK_SYNC_HEADER_ENTITYID]: remoteEntityId,
                },
                body: JSON.stringify(opers),
            });

            if (res.status !== 200) {
                throw new Error(`sync数据时，访问api「${finalApi}」的结果不是200。「${res.status}」`);
            }
            json = await res.json();
        }
        catch (err: any) {
            console.error('sync push时出现error', err);
            needRetry = true;
            restOpers = queue;
        }

        if (!needRetry) {
            /**
             * 返回结构见this.getSelfEndpoint
             */
            const { successIds, failed } = json!;
            if (failed) {
                needRetry = true;
                const {
                    id, error
                } = failed;
                console.error('同步过程中发生异常', id, error);
            }
            for (const req of queue) {
                if (successIds.includes(req.oper.id!)) {
                    req.resolve();
                }
                else {
                    restOpers.push(req);
                }
            }
        }

        if (restOpers.length > 0) {
            const interval = Math.max(0, channel.nextPushTimestamp - Date.now());
            const retry2 = needRetry ? (typeof retry === 'number' ? retry + 1 : 1) : undefined;
            console.log('need retry', retry2);
            setTimeout(() => this.pushOnChannel(remoteEntity, remoteEntityId, context, channel, retry2), interval);
        }
        else {
            channel.handler = undefined;
            channel.nextPushTimestamp = undefined;
        }
    }

    // 将产生的oper推送到远端Node。注意要尽量在本地阻止重复推送
    /** 
     * 推向远端Node的oper，需要严格保证按产生的时间序推送。根据幂等原理，这里必须要推送成功
     * 因此在这里要实现两点：
     * 1）oper如果推送失败了，必须留存在queue中，以保证在后面产生的oper之前推送
     * 2）当对queue中增加oper时，要检查是否有重（有重说明之前失败过），如果无重则将之放置在队列尾
     * 
     * 其实这里还无法严格保证先产生的oper一定先到达被推送，因为volatile trigger是在事务提交后再发生的，但这种情况在目前应该跑不出来，在实际执行oper的时候assert掉先。by Xc 20240226
     */
    private async pushOper(
        context: Cxt,
        oper: Partial<ED['oper']['Schema']>,
        userId: string,
        url: string,
        endpoint: string,
        remoteEntity: keyof ED,
        remoteEntityId: string,
        nextPushTimestamp?: number
    ) {
        if (!this.remotePushChannel[userId]) {
            this.remotePushChannel[userId] = {
                api: join(url, 'endpoint', endpoint),
                queue: [],
            };
        }
        const channel = this.remotePushChannel[userId];

        // 要去重且有序
        let existed = false;
        let idx = 0;
        for (; idx < channel.queue.length; idx++) {
            if (channel.queue[idx].oper.id === oper.id) {
                existed = true;
                break;
            }
            else if (channel.queue[idx].oper.bornAt! > oper.bornAt!) {
                break;
            }
        }
        if (!existed) {
            const now = Date.now();
            const nextPushTimestamp2 = nextPushTimestamp || now + 1000;
            const waiter = new Promise<void>(
                (resolve, reject) => {
                    if (!existed) {
                        channel.queue.splice(idx, 0, {
                            oper,
                            resolve,
                            reject,
                        });
                    }
                }
            );
            if (!channel.handler) {
                channel.nextPushTimestamp = nextPushTimestamp2;
                channel.handler = setTimeout(async () => {
                    await this.pushOnChannel(remoteEntity, remoteEntityId, context, channel);
                }, nextPushTimestamp2 - now);
            }
            else if (channel.nextPushTimestamp && channel.nextPushTimestamp > nextPushTimestamp2) {
                // 当前队列的开始时间要晚于自身的要求，要求提前开始
                channel.nextPushTimestamp = nextPushTimestamp2;
            }

            await waiter;
        }
        else {
            // 感觉应该跑不出来
            console.warn('在sync数据时，遇到了重复推送的oper', JSON.stringify(oper), userId, url);
        }
    }

    private async getSelfEncryptInfo(context: Cxt) {
        if (this.selfEncryptInfo) {
            return this.selfEncryptInfo;
        }
        this.selfEncryptInfo = await this.config.self.getSelfEncryptInfo(context);
        return this.selfEncryptInfo!;
    }

    private makeCreateOperTrigger() {
        const { config } = this;
        const { remotes, self } = config;

        // 根据remotes定义，建立从entity到需要同步的远端结点信息的Map
        const pushAccessMap: Record<string, Array<{
            projection: ED[keyof ED]['Selection']['data'];                                                       // 从entity上取到相关user需要的projection
            groupByUsers: (row: Partial<ED[keyof ED]['Schema']>[]) => Record<string, {
                entity: keyof ED;       // 对方目标对象
                entityId: string;       // 对象目标对象Id
                rowIds: string[];       // 要推送的rowId
            }>;        // 根据相关数据行关联的userId，对行ID进行重分组，键值为userId
            getRemotePushInfo: SyncConfig<ED, Cxt>['remotes'][number]['getPushInfo'];                            // 根据userId获得相应push远端的信息
            endpoint: string;                                                                                    // 远端接收endpoint的url
            actions?: string[];
            onSynchronized: PushEntityDef<ED, keyof ED, Cxt>['onSynchronized'];
            entity: keyof ED;
        }>> = {};
        remotes.forEach(
            (remote) => {
                const { getPushInfo, pushEntities: pushEntityDefs, endpoint, pathToUser, relationName: rnRemote } = remote;
                if (pushEntityDefs) {
                    const pushEntities = [] as Array<keyof ED>;
                    const endpoint2 = join(endpoint || 'sync', self.entity as string);
                    for (const def of pushEntityDefs) {
                        const { path, relationName, recursive, entity, actions, onSynchronized } = def;
                        pushEntities.push(entity);

                        const relationName2 = relationName || rnRemote;
                        const path2 = pathToUser ? `${path}.${pathToUser}` : path;
                        const {
                            projection,
                            getData
                        } = relationName2 ? destructRelationPath(this.schema, entity, path2, {
                            relation: {
                                name: relationName,
                            }
                        }, recursive) : destructDirectPath(this.schema, entity, path2, recursive);

                        const groupByUsers = (rows: Partial<ED[keyof ED]['Schema']>[]) => {
                            const userRowDict: Record<string, {
                                rowIds: string[];
                                entityId: string;
                                entity: keyof ED;
                            }> = {};
                            rows.forEach(
                                (row) => {
                                    const goals = getData(row);
                                    if (goals) {
                                        goals.forEach(
                                            ({ entity, entityId, userId }) => {
                                                if (userRowDict[userId]) {
                                                    // 逻辑上来说同一个userId，其关联的entity和entityId必然相同，这个entity/entityId代表了对方
                                                    assert(userRowDict[userId].entity === entity && userRowDict[userId].entityId === entityId);
                                                    userRowDict[userId].rowIds.push(row.id!);
                                                }
                                                else {
                                                    userRowDict[userId] = {
                                                        entity,
                                                        entityId,
                                                        rowIds: [row.id!],
                                                    };
                                                }

                                            }
                                        )
                                    }
                                }
                            );
                            return userRowDict;
                        };

                        if (!pushAccessMap[entity as string]) {
                            pushAccessMap[entity as string] = [{
                                projection,
                                groupByUsers,
                                getRemotePushInfo: getPushInfo,
                                endpoint: endpoint2,
                                entity,
                                actions,
                                onSynchronized
                            }];
                        }
                        else {
                            pushAccessMap[entity as string].push({
                                projection,
                                groupByUsers,
                                getRemotePushInfo: getPushInfo,
                                endpoint: endpoint2,
                                entity,
                                actions,
                                onSynchronized
                            });
                        }
                    }
                }
            }
        );

        const pushEntities = Object.keys(pushAccessMap);

        // push相关联的entity，在发生操作时，需要将operation推送到远端
        const createOperTrigger: VolatileTrigger<ED, 'oper', Cxt> = {
            name: 'push oper to remote node',
            entity: 'oper',
            action: 'create',
            when: 'commit',
            strict: 'makeSure',
            check: (operation: ED['oper']['Create']) => {
                const { data } = operation;
                return pushEntities.includes((<ED['oper']['CreateSingle']['data']>data).targetEntity!);
            },
            fn: async ({ ids }, context) => {
                assert(ids.length === 1);
                const [oper] = await context.select('oper', {
                    data: {
                        id: 1,
                        action: 1,
                        data: 1,
                        targetEntity: 1,
                        operatorId: 1,
                        operEntity$oper: {
                            $entity: 'operEntity',
                            data: {
                                id: 1,
                                entity: 1,
                                entityId: 1,
                            },
                        },
                        bornAt: 1,
                        $$createAt$$: 1,
                    },
                    filter: {
                        id: ids[0],
                    }
                }, { dontCollect: true, forUpdate: true });
                const { operatorId, targetEntity, operEntity$oper: operEntities, action, data } = oper;
                const entityIds = operEntities!.map(
                    ele => ele.entityId!
                );

                const pushEntityNodes = pushAccessMap[targetEntity!];
                if (pushEntityNodes && pushEntityNodes.length > 0) {
                    // 每个pushEntityNode代表配置的一个remoteEntity 
                    await Promise.all(
                        pushEntityNodes.map(
                            async (node) => {
                                const { projection, groupByUsers, getRemotePushInfo: getRemoteAccessInfo, endpoint, actions, onSynchronized } = node;
                                if (!actions || actions.includes(action!)) {
                                    const pushed = [] as Promise<void>[];
                                    const rows = await context.select(targetEntity!, {
                                        data: {
                                            id: 1,
                                            ...projection,
                                        },
                                        filter: {
                                            id: {
                                                $in: entityIds,
                                            },
                                        },
                                    }, { dontCollect: true, includedDeleted: true });

                                    // userId就是需要发送给远端的user，但是要将本次操作的user过滤掉（操作的原本产生者）
                                    const userSendDict = groupByUsers(rows);
                                    const pushToUserIdFn = async (userId: string) => {
                                        const { entity, entityId, rowIds } = userSendDict[userId];
                                        // 推送到远端结点的oper
                                        const oper2 = {
                                            id: oper.id!,
                                            action: action!,
                                            data: (action === 'create' && data instanceof Array) ? data.filter(ele => rowIds.includes(ele.id)) : data!,
                                            filter: {
                                                id: rowIds.length === 1 ? rowIds[0] : {
                                                    $in: rowIds,
                                                }
                                            },
                                            bornAt: oper.bornAt!,
                                            targetEntity,
                                        };
                                        const { url } = await getRemoteAccessInfo(context, {
                                            userId,
                                            remoteEntityId: entityId,
                                        });
                                        await this.pushOper(context, oper2 as any /** 这里不明白为什么TS过不去 */, userId, url, endpoint, entity, entityId);
                                    };
                                    for (const userId in userSendDict) {
                                        if (userId !== operatorId) {
                                            pushed.push(pushToUserIdFn(userId));
                                        }
                                    }

                                    if (pushed.length > 0) {
                                        await Promise.all(pushed);
                                        if (onSynchronized) {
                                            await onSynchronized({
                                                action: action!,
                                                data: data!,
                                                rowIds: entityIds,
                                            }, context);
                                        }
                                    }
                                }
                            }
                        )
                    );

                    return entityIds.length * pushEntityNodes.length;
                }
                return 0;
            }
        };

        return createOperTrigger;
    }

    constructor(config: SyncConfig<ED, Cxt>, schema: StorageSchema<ED>) {
        this.config = config;
        this.schema = schema;
    }

    /**
     * 根据sync的定义，生成对应的 commit triggers
     * @returns 
     */
    getSyncTriggers() {
        return [this.makeCreateOperTrigger()] as Array<VolatileTrigger<ED, keyof ED, Cxt>>;
    }

    getSelfEndpoint(): EndpointItem<ED, Cxt> {
        return {
            name: this.config.self.endpoint || 'sync',
            method: 'post',
            params: ['entity', 'entityId'],
            fn: async (context, params, headers, req, body): Promise<{
                successIds: string[],
                failed?: {
                    id: string;
                    error: string;
                };
            }> => {
                // body中是传过来的oper数组信息
                const { entity, entityId } = params;
                const { [OAK_SYNC_HEADER_ENTITY]: meEntity, [OAK_SYNC_HEADER_ENTITYID]: meEntityId } = headers;

                console.log('接收到来自远端的sync数据', entity, JSON.stringify(body));
                const successIds = [] as string[];
                let failed: {
                    id: string;
                    error: string;
                } | undefined;
                // todo 这里先缓存，不考虑本身同步相关信息的更新
                if (!this.remotePullInfoMap[entity]) {
                    this.remotePullInfoMap[entity] = {};
                }
                if (!this.remotePullInfoMap[entity]![entityId]) {
                    const { getPullInfo, pullEntities } = this.config.remotes.find(ele => ele.entity === entity)!;
                    const pullEntityDict = {} as Record<string, PullEntityDef<ED, keyof ED, Cxt>>;
                    if (pullEntities) {
                        pullEntities.forEach(
                            (def) => pullEntityDict[def.entity as string] = def
                        );
                    }
                    this.remotePullInfoMap[entity]![entityId] = {
                        pullInfo: await getPullInfo(context, {
                            selfId: meEntityId as string,
                            remoteEntityId: entityId,
                        }),
                        pullEntityDict,
                    };
                }

                const { pullInfo, pullEntityDict } = this.remotePullInfoMap[entity][entityId]!;
                const { userId, algorithm, publicKey, cxtInfo } = pullInfo;
                assert(userId);
                context.setCurrentUserId(userId);
                if (cxtInfo) {
                    await context.initialize(cxtInfo);
                }
                const selfEncryptInfo = await this.getSelfEncryptInfo(context);
                assert(selfEncryptInfo.id === meEntityId && meEntity === this.config.self.entity);
                // todo 解密

                if (!this.pullMaxBornAtMap.hasOwnProperty(entityId)) {
                    const [maxHisOper] = await context.select('oper', {
                        data: {
                            id: 1,
                            bornAt: 1,
                        },
                        filter: {
                            operatorId: userId,
                        },
                        sorter: [
                            {
                                $attr: {
                                    bornAt: 1,
                                },
                                $direction: 'desc',
                            },
                        ],
                        indexFrom: 0,
                        count: 1,
                    }, { dontCollect: true });
                    this.pullMaxBornAtMap[entityId] = maxHisOper?.bornAt as number || 0;
                }

                let maxBornAt = this.pullMaxBornAtMap[entityId]!;
                const opers = body as ED['oper']['Schema'][];

                const outdatedOpers = opers.filter(
                    ele => ele.bornAt as number <= maxBornAt
                );
                const freshOpers = opers.filter(
                    ele => ele.bornAt as number > maxBornAt
                );

                await Promise.all(
                    [
                        // 无法严格保证推送按bornAt，所以一旦还有outdatedOpers，检查其已经被apply
                        (async () => {
                            const ids = outdatedOpers.map(
                                ele => ele.id
                            );
                            if (ids.length > 0) {
                                const opersExisted = await context.select('oper', {
                                    data: {
                                        id: 1,
                                    },
                                    filter: {
                                        id: {
                                            $in: ids!,
                                        }
                                    }
                                }, { dontCollect: true });
                                if (opersExisted.length < ids.length) {
                                    const missed = difference(ids, opersExisted.map(ele => ele.id));
                                    // todo 这里如果远端业务逻辑严格，发生乱序应是无关的oper，直接执行就好 by Xc
                                    throw new Error(`在sync过程中发现有丢失的oper数据「${missed}」`);
                                }
                                successIds.push(...ids);
                            }
                        })(),
                        (async () => {
                            for (const freshOper of freshOpers) {
                                // freshOpers是按bornAt序产生的
                                const { id, targetEntity, action, data, bornAt, filter } = freshOper;
                                const ids = getRelevantIds(filter!);
                                assert(ids.length > 0);

                                try {
                                    if (pullEntityDict && pullEntityDict[targetEntity]) {
                                        const { process } = pullEntityDict[targetEntity];
                                        if (process) {
                                            await process(action!, data, context);
                                        }
                                    }
                                    const operation: ED[keyof ED]['Operation'] = {
                                        id,
                                        data,
                                        action,
                                        filter: {
                                            id: ids.length === 1 ? ids[0] : {
                                                $in: ids,
                                            },
                                        },
                                        bornAt: bornAt as number,
                                    };
                                    await context.operate(targetEntity, operation, {});
                                    successIds.push(id);
                                    maxBornAt = bornAt as number;
                                }
                                catch (err: any) {
                                    console.error('sync时出错', entity, JSON.stringify(freshOper));
                                    failed = {
                                        id,
                                        error: err.toString(),
                                    };
                                    break;
                                }
                            }
                        })()
                    ]
                );

                this.pullMaxBornAtMap[entityId] = maxBornAt;
                return {
                    successIds,
                    failed,
                };
            }
        };
    }
}