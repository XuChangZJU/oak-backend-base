import {
    EntityDict, StorageSchema, EndpointItem, RemotePullInfo, SelfEncryptInfo,
    RemotePushInfo, PushEntityDef, PullEntityDef, SyncConfig, TriggerDataAttribute, TriggerUuidAttribute, OakException, Routine, Watcher
} from 'oak-domain/lib/types';
import { VolatileTrigger } from 'oak-domain/lib/types/Trigger';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { destructRelationPath, destructDirectPath } from 'oak-domain/lib/utils/relationPath';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import assert from 'assert';
import { join } from 'path';
import { difference } from 'oak-domain/lib/utils/lodash';
import { getRelevantIds } from 'oak-domain/lib/store/filter';
import { generateNewIdAsync } from 'oak-domain/lib/utils/uuid';

const OAK_SYNC_HEADER_ENTITY = 'oak-sync-entity';
const OAK_SYNC_HEADER_ENTITYID = 'oak-sync-entity-id';

// 一个channel是代表要推送的一个目标对象
type Channel<ED extends EntityDict & BaseEntityDict> = {
    queue: Array<{
        resolve: (value: unknown) => void;
        oper: Partial<ED['oper']['Schema']>;
    }>;            // 要推送的oper队列
    api: string;                                            // 推送的api
    nextPushTimestamp: number;                             // 下一次推送的时间戳
    handler?: ReturnType<typeof setTimeout>;                // 推送定时器
    entity: keyof ED;
    entityId: string;
    running: boolean;
    selfEncryptInfo: SelfEncryptInfo;
};

export default class Synchronizer<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    private config: SyncConfig<ED, Cxt>;
    private schema: StorageSchema<ED>;
    private remotePullInfoMap: Record<string, Record<string, {
        pullInfo: RemotePullInfo,
        pullEntityDict: Record<string, PullEntityDef<ED, keyof ED, Cxt>>;
    }>> = {};
    private pullMaxBornAtMap: Record<string, number> = {};
    private remotePushChannel: Record<string, Channel<ED>> = {};

    private pushAccessMap: Record<string, Array<{
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

    /**
     * 向某一个远端对象push opers。根据幂等性，这里如果失败了必须反复推送
     * @param channel 
     * @param retry 
     */
    private async startChannel(channel: Channel<ED>, retry: number) {
        const { queue, api, selfEncryptInfo, entity, entityId } = channel;

        channel.queue = [];
        channel.running = true;
        channel.nextPushTimestamp = Number.MAX_SAFE_INTEGER;

        const opers = queue.map(ele => ele.oper);

        let failedOpers = [] as typeof queue;
        let needRetry = false;
        let json: {
            successIds: string[], failed: {
                id: string;
                error: string;
            }
        };
        try {
            // todo 加密

            console.log('向远端结点sync数据', api, JSON.stringify(opers));
            const finalApi = join(api, selfEncryptInfo.id);
            const res = await fetch(finalApi, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json',
                    [OAK_SYNC_HEADER_ENTITY]: entity as string,
                    [OAK_SYNC_HEADER_ENTITYID]: entityId,
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
            failedOpers = queue;
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
                    req.resolve(undefined);
                }
                else {
                    failedOpers.push(req);
                }
            }
        }

        channel.running = false;
        channel.handler = undefined;
        const retry2 = retry + 1;
        console.log('need retry', retry2);
        this.joinChannel(channel, failedOpers, retry2);
    }

    private joinChannel(channel: Channel<ED>, opers: {
        oper: Partial<ED['oper']['Schema']>,
        resolve: (value: unknown) => void,
    }[], retry: number) {
        // 要去重且有序
        let idx = 0;
        const now = Date.now();
        opers.forEach(
            (oper) => {
                for (; idx < channel.queue.length; idx++) {
                    if (channel.queue[idx].oper.id === oper.oper.id) {
                        assert(false, '不应当出现重复的oper');
                        break;
                    }
                    else if (channel.queue[idx].oper.bornAt! > oper.oper.bornAt!) {
                        break;
                    }
                }
                channel.queue.splice(idx, 0, oper);
            }
        );
        const retryWeight = Math.pow(2, Math.min(retry, 10));
        const nextPushTimestamp = retryWeight * 1000 + now;

        if (channel.queue.length > 0) {
            if (channel.running) {
                if (channel.nextPushTimestamp > nextPushTimestamp) {
                    channel.nextPushTimestamp = nextPushTimestamp;
                }
            }
            else {
                if (channel.nextPushTimestamp > nextPushTimestamp) {
                    channel.nextPushTimestamp = nextPushTimestamp;
                    if (channel.handler) {
                        clearTimeout(channel.handler);
                    }
                    channel.handler = setTimeout(async () => {
                        await this.startChannel(channel, retry);
                    }, nextPushTimestamp - now);
                }
                else {
                    // 当前队列的开始时间要早于自身要求，不用管
                    assert(channel.handler);
                }
            }
        }
        else {
            channel.handler = undefined;
            channel.nextPushTimestamp = Number.MAX_SAFE_INTEGER;
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
        oper: Partial<ED['oper']['Schema']>,
        userId: string,
        url: string,
        endpoint: string,
        remoteEntity: keyof ED,
        remoteEntityId: string,
        selfEncryptInfo: SelfEncryptInfo,
    ) {

        if (!this.remotePushChannel[userId]) {
            // channel上缓存这些信息，暂不支持动态更新
            this.remotePushChannel[userId] = {
                api: join(url, 'endpoint', endpoint),
                queue: [],
                entity: remoteEntity,
                entityId: remoteEntityId,
                nextPushTimestamp: Number.MAX_SAFE_INTEGER,
                running: false,
                selfEncryptInfo,
            };
        }
        const channel = this.remotePushChannel[userId];
        assert(channel.api === join(url, 'endpoint', endpoint));
        assert(channel.entity === remoteEntity);
        assert(channel.entityId === remoteEntityId);

        const promise = new Promise(
            (resolve) => {
                this.joinChannel(channel, [{
                    oper,
                    resolve,
                }], 0);
            }
        );

        await promise;
    }

    /**
     * 因为应用可能是多租户，得提前确定context下的selfEncryptInfo
     * 由于checkpoint时无法区别不同上下文之间的未完成oper数据，所以接口只能这样设计
     * @param id 
     * @param context 
     * @param selfEncryptInfo 
     * @returns 
     */
    private async synchronizeOpersToRemote(id: string, context: Cxt, selfEncryptInfo: SelfEncryptInfo) {
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
                filter: 1,
            },
            filter: {
                id,
            }
        }, { dontCollect: true, forUpdate: true });

        const { operatorId, targetEntity, operEntity$oper: operEntities, action, data } = oper;
        const entityIds = operEntities!.map(
            ele => ele.entityId!
        );

        const pushEntityNodes = this.pushAccessMap[targetEntity!];
        if (pushEntityNodes && pushEntityNodes.length > 0) {
            // 每个pushEntityNode代表配置的一个remoteEntity 
            await Promise.all(
                pushEntityNodes.map(
                    async (node) => {
                        const { projection, groupByUsers, getRemotePushInfo: getRemoteAccessInfo, endpoint, actions, onSynchronized } = node;
                        // 定义中应该不可能没有actions
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

                                await this.pushOper(oper, userId, url, endpoint, entity, entityId, selfEncryptInfo);
                            };
                            for (const userId in userSendDict) {
                                if (userId !== operatorId) {
                                    pushed.push(pushToUserIdFn(userId));
                                }
                            }

                            if (pushed.length > 0) {
                                // 对单个oper，这里必须要等所有的push返回，不然会一直等在上面
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

            // 到这里说明此oper成功，否则会在内部不停循环重试
            // 主动去把oper上的跨事务标志清除，不依赖底层的triggerExecutor
            await context.operate('oper', {
                id: await generateNewIdAsync(),
                action: 'update',
                data: {
                    [TriggerDataAttribute]: null,
                    [TriggerUuidAttribute]: null,
                },
                filter: {
                    id
                },
            }, {});
        }
        return 0;
    }

    private makeCreateOperTrigger() {
        const { config } = this;
        const { remotes, self } = config;

        // 根据remotes定义，建立从entity到需要同步的远端结点信息的Map
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

                        if (!this.pushAccessMap[entity as string]) {
                            this.pushAccessMap[entity as string] = [{
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
                            this.pushAccessMap[entity as string].push({
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

        const pushEntities = Object.keys(this.pushAccessMap);

        // push相关联的entity，在发生操作时，需要将operation推送到远端
        const createOperTrigger: VolatileTrigger<ED, 'oper', Cxt> = {
            name: 'push oper to remote node',
            entity: 'oper',
            action: 'create',
            when: 'commit',
            strict: 'makeSure',
            check: (operation: ED['oper']['Create']) => {
                const { data } = operation as ED['oper']['CreateSingle'];
                const { targetEntity, action } = data;
                return pushEntities.includes((<ED['oper']['CreateSingle']['data']>data).targetEntity!)
                    && !!this.pushAccessMap[targetEntity!].find(({ actions }) => !actions || actions.includes(action!));
            },
            fn: async ({ ids }, context) => {
                assert(ids.length === 1);
                const selfEncryptInfo = await this.config.self.getSelfEncryptInfo(context);
                this.synchronizeOpersToRemote(ids[0], context, selfEncryptInfo);
                throw new OakException('consistency on oper will be managed by myself');
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

    getSyncRoutine(): Watcher<ED, keyof ED, Cxt> {
        return {
            name: 'checkpoint routine for sync',
            entity: 'oper',
            filter: {
                [TriggerDataAttribute]: {
                    $exists: true,
                }
            } as ED[keyof ED]['Selection']['filter'],
            projection: {
                id: 1,
                [TriggerDataAttribute]: 1,
            } as ED[keyof ED]['Selection']['data'],
            fn: async (context, data) => {
                for (const ele of data) {
                    const { id, [TriggerDataAttribute]: triggerData } = ele;
                    const { cxtStr = '{}' } = triggerData!;

                    await context.initialize(JSON.parse(cxtStr), true);
                    const selfEncryptInfo = await this.config.self.getSelfEncryptInfo(context);
                    this.synchronizeOpersToRemote(id!, context, selfEncryptInfo);
                }
                return {};
            }
        };
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
                                    console.error(err);
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