import {
    EntityDict, StorageSchema, EndpointItem, RemotePullInfo, SelfEncryptInfo,
    RemotePushInfo, PushEntityDef, PullEntityDef, SyncConfig, TriggerDataAttribute, TriggerUuidAttribute, OakException, Routine, Watcher, FreeRoutine, OakMakeSureByMySelfException
} from 'oak-domain/lib/types';
import { VolatileTrigger } from 'oak-domain/lib/types/Trigger';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { destructRelationPath, destructDirectPath, destructDirectUserPath } from 'oak-domain/lib/utils/relationPath';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import assert from 'assert';
import { join } from 'path';
import { difference } from 'oak-domain/lib/utils/lodash';
import { getRelevantIds } from 'oak-domain/lib/store/filter';
import { generateNewIdAsync } from 'oak-domain/lib/utils/uuid';
import { merge, uniq, unset } from 'lodash';

const OAK_SYNC_HEADER_ENTITY = 'oak-sync-entity';
const OAK_SYNC_HEADER_ENTITYID = 'oak-sync-entity-id';

// 一个channel是代表要推送的一个目标对象
type Channel<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> = {
    queue: Array<{
        oper: Partial<ED['oper']['Schema']>;
        onSynchronized?: PushEntityDef<ED, keyof ED, Cxt>['onSynchronized'];
    }>;            // 要推送的oper队列
    api: string;                                            // 推送的api
    entity: keyof ED;
    entityId: string;
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
    private channelDict: Record<string, Channel<ED, Cxt>> = {};

    private pushAccessMap: Record<string, Array<{
        projection: ED[keyof ED]['Selection']['data'];                                                       // 从entity上取到相关user需要的projection
        groupByUsers: (rows: Partial<ED[keyof ED]['Schema']>[]) => Record<string, {
            entity: keyof ED;       // 对方目标对象
            entityId: string;       // 对象目标对象Id
            rowIds: string[];       // 要推送的rowId
        }>;        // 根据相关数据行关联的userId，对行ID进行重分组，键值为userId
        groupBySelfEntity: (rows: Partial<ED[keyof ED]['Schema']>[]) => Record<string, string>;
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
    private async startChannel(context: Cxt, channel: Channel<ED, Cxt>, retry: number) {
        const { queue, api, selfEncryptInfo, entity, entityId } = channel;

        let json: {
            successIds: string[],
            redundantIds: string[],
            failed: {
                id: string;
                error: string;
            }
        };
        try {
            // todo 加密
            const queue = channel.queue;
            const opers = queue.map(ele => ele.oper);
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
            // 最大延迟redo时间512秒
            const retryDelay = Math.pow(2, Math.min(9, retry)) * 1000;
            console.error('sync push时出现error', err);
            console.error(`将于${retryDelay}毫秒后重试`);
            return new Promise(
                (resolve) => {
                    setTimeout(async () => {
                        await this.startChannel(context, channel, retry + 1);
                        resolve(undefined);
                    }, retryDelay);
                }
            );
        }

        /**
         * 返回结构见this.getSelfEndpoint
         */
        const { successIds, failed, redundantIds } = json!;
        if (failed) {
            const {
                id, error
            } = failed;
            console.error('同步过程中发生异常', id, error, retry);
        }
        const unsuccessfulOpers = queue.filter(
            ele => !successIds.includes(ele.oper.id!) && !redundantIds.includes(ele.oper.id!)
        );
        // 重新开始前，可以将已经完成的oper的triggerData位清零。要注意，在多个remote配置下，有可能一个oper要推给多个channel
        // 这里可能设计过度了，代码也没经过测试
        channel.queue = unsuccessfulOpers;

        const aliveOperIds = [] as string[];
        for (const k in this.channelDict) {
            if (this.channelDict[k].queue.length > 0) {
                aliveOperIds.push(...this.channelDict[k].queue.map(ele => ele.oper.id!));
            }
        }

        const overIds = difference(successIds.concat(redundantIds), aliveOperIds);
        if (overIds.length > 0) {
            await context.operate('oper', {
                id: await generateNewIdAsync(),
                action: 'update',
                data: {
                    [TriggerDataAttribute]: null,
                    [TriggerUuidAttribute]: null,
                },
                filter: {
                    id: {
                        $in: overIds,
                    }
                }
            }, {});
        }
        
        if (successIds.length > 0) {
            try {
                await Promise.all(
                    successIds.map(
                        (id) => {
                            const { onSynchronized, oper } = queue.find(ele => ele.oper.id === id)!;
                            return onSynchronized && onSynchronized({
                                action: oper.action!,
                                data: oper.data!,
                                rowIds: getRelevantIds(oper.filter!),
                            }, context);
                        }
                    )
                )
            }
            catch (err) {
                // 这时候无法处理？
                console.error('onSynchronzied时出错', err);
                assert(false);
            }
        }

        if (channel.queue.length > 0) {
            // 最大延迟redo时间512秒
            const retryDelay = Math.pow(2, Math.min(9, retry)) * 1000;
            console.error(`有${channel.queue.length}个oper同步失败，将于${retryDelay}毫秒后重试`);
            
            return new Promise(
                (resolve) => {
                    setTimeout(async () => {
                        await this.startChannel(context, channel, retry + 1);
                        resolve(undefined);
                    }, retryDelay);
                }
            );
        }
    }

    private async startAllChannel(context: Cxt) {
        await Promise.all(
            Object.keys(this.channelDict).map(
                async (k) => {
                    const channel = this.channelDict[k];
                    if (channel.queue.length > 0) {
                        channel.queue.sort(
                            (o1, o2) => (o1.oper.$$seq$$ as number) - (o2.oper.$$seq$$ as number)
                        );
                        return this.startChannel(context, channel, 0);
                    }
                }
            )
        );
    }

    private pushOperToChannel(
        oper: Partial<ED['oper']['Schema']>,
        userId: string,
        url: string,
        endpoint: string,
        remoteEntity: keyof ED,
        remoteEntityId: string,
        selfEncryptInfo: SelfEncryptInfo,
        onSynchronized?: PushEntityDef<ED, keyof ED, Cxt>['onSynchronized']
    ) {

        if (!this.channelDict[userId]) {
            // channel上缓存这些信息，暂不支持动态更新
            this.channelDict[userId] = {
                api: join(url, 'endpoint', endpoint),
                queue: [],
                entity: remoteEntity,
                entityId: remoteEntityId,
                selfEncryptInfo,
            };
        }
        else {
            // 趁机更新一下加密信息
            this.channelDict[userId].selfEncryptInfo = selfEncryptInfo;
        }
        const channel = this.channelDict[userId];
        assert(channel.api === join(url, 'endpoint', endpoint));
        assert(channel.entity === remoteEntity);
        assert(channel.entityId === remoteEntityId);

        channel.queue.push({
            oper,
            onSynchronized,
        });
    }

    private refineOperData(oper: Partial<ED['oper']['OpSchema']>, rowIds: string[]) {
        const { action, id, targetEntity, data, $$seq$$, filter } = oper;

        const data2 = (action === 'create' && data instanceof Array) ? data.filter(ele => rowIds.includes(ele.id)) : data!;
        // 过滤掉数据中的跨事务trigger信息
        if (data2 instanceof Array) {
            data2.forEach(
                (d) => {
                    unset(d, TriggerDataAttribute);
                    unset(d, TriggerUuidAttribute);
                }
            );
        }
        else {
            unset(data2, TriggerDataAttribute);
            unset(data2, TriggerUuidAttribute);
        }

        return {
            id, action, targetEntity, data: data2, $$seq$$, filter,
        } as Partial<ED['oper']['OpSchema']>;
    }

    private async dispatchOperToChannels(oper: Partial<ED['oper']['Schema']>, context: Cxt) {
        const { operatorId, targetEntity, filter, action, data } = oper;
        const entityIds = getRelevantIds(filter!);
        assert(entityIds.length > 0);

        const pushEntityNodes = this.pushAccessMap[targetEntity!];
        let pushed = false;
        if (pushEntityNodes && pushEntityNodes.length > 0) {
            // 每个pushEntityNode代表配置的一个remoteEntity 
            await Promise.all(
                pushEntityNodes.map(
                    async (node) => {
                        const { projection, groupByUsers, getRemotePushInfo: getRemoteAccessInfo,
                            groupBySelfEntity, endpoint, actions, onSynchronized } = node;
                        // 定义中应该不可能没有actions
                        if (!actions || actions.includes(action!)) {
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
                            const selfEntityIdDict = groupBySelfEntity(rows);
                            const encryptInfoDict: Record<string, SelfEncryptInfo> = {};
                            const pushToUserIdFn = async (userId: string) => {
                                const { entity, entityId, rowIds } = userSendDict[userId];
                                const selfEntityIds = rowIds.map(
                                    (rowId) => selfEntityIdDict[rowId]
                                );
                                const uniqSelfEntityIds = uniq(selfEntityIds);
                                assert(uniqSelfEntityIds.length === 1, '推向同一个userId的oper不可能关联在多个不同的selfEntity行上');
                                const selfEntityId = uniqSelfEntityIds[0];
                                if (!encryptInfoDict[selfEntityId]) {
                                    encryptInfoDict[selfEntityId] = await this.config.self.getSelfEncryptInfo(context, selfEntityId);
                                }
                                const selfEncryptInfo = encryptInfoDict[selfEntityId]!;
                                // 推送到远端结点的oper
                                const oper2 = this.refineOperData(oper, rowIds);
                                const { url } = await getRemoteAccessInfo(context, {
                                    userId,
                                    remoteEntityId: entityId,
                                });

                                this.pushOperToChannel(oper2, userId, url, endpoint, entity, entityId, selfEncryptInfo, onSynchronized);
                            };

                            for (const userId in userSendDict) {
                                if (userId !== operatorId) {
                                    await pushToUserIdFn(userId);
                                    pushed = true;
                                }
                            }
                        }
                    }
                )
            );
        }

        // 如果oper一个也不用推送，说明其定义的推送path和对象行的path不匹配（动态指针）
        return pushed;
    }

    /**
     * 为了保证推送的oper序，采用从database中顺序读取所有需要推送的oper来进行推送
     * 每个进程都保证把当前所有的oper顺序处理掉，就不会有乱序的问题，大家通过database上的锁来完成同步
     * @param context 
     */
    private async trySynchronizeOpers(context: Cxt) {
        let dirtyOpers = await context.select('oper', {
            data: {
                id: 1,
            },
            filter: {
                [TriggerDataAttribute]: {
                    $exists: true,
                },
            } as any
        }, { dontCollect: true });

        if (dirtyOpers.length > 0) {
            // 这一步是加锁，保证只有一个进程完成推送，推送者提交前会将$$triggerData$$清零
            const ids = dirtyOpers.map(ele => ele.id!);
            dirtyOpers = await context.select('oper', {
                data: {
                    id: 1,
                    action: 1,
                    data: 1,
                    targetEntity: 1,
                    operatorId: 1,
                    [TriggerDataAttribute]: 1,
                    bornAt: 1,
                    $$createAt$$: 1,
                    $$seq$$: 1,
                    filter: 1,
                },
                filter: {
                    id: { $in: ids },
                },
            }, { dontCollect: true, forUpdate: true });

            dirtyOpers = dirtyOpers.filter(
                ele => !!(ele as any)[TriggerDataAttribute]
            );
            if (dirtyOpers.length > 0) {
                const pushedIds = [] as string[];
                const unpushedIds = [] as string[]; 
                await Promise.all(
                    dirtyOpers.map(
                        async (oper) => {
                            const result = await this.dispatchOperToChannels(oper, context);
                            if (result) {
                                pushedIds.push(oper.id!);
                            }
                            else {
                                unpushedIds.push(oper.id!);
                            }
                        }
                    )
                );
                if (unpushedIds.length > 0) {
                    await context.operate('oper', {
                        id: await generateNewIdAsync(),
                        action: 'update',
                        data: {
                            [TriggerDataAttribute]: null,
                            [TriggerUuidAttribute]: null,
                        },
                        filter: {
                            id: {
                                $in: unpushedIds,
                            }
                        }
                    }, {});
                }
                if (pushedIds.length >0) {
                    await this.startAllChannel(context);
                }
            }
        }
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
                        const { pathToRemoteEntity, pathToSelfEntity, relationName, recursive, entity, actions, onSynchronized } = def;
                        pushEntities.push(entity);

                        const relationName2 = relationName || rnRemote;
                        const path2 = pathToUser ? `${pathToRemoteEntity}.${pathToUser}` : pathToRemoteEntity;

                        assert(!recursive);
                        const {
                            projection,
                            getData
                        } = relationName2 ? destructRelationPath(this.schema, entity, path2, {
                            relation: {
                                name: relationName,
                            }
                        }, recursive) : destructDirectUserPath(this.schema, entity, path2);

                        const toSelfEntity = destructDirectPath(this.schema, entity, pathToSelfEntity);

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
                                                assert(userId);
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

                        const projectionMerged = merge(projection, toSelfEntity.projection);
                        const groupBySelfEntity = (rows: Partial<ED[keyof ED]['Schema']>[]) => {
                            const selfEntityIdDict: Record<string, string> = {};
                            for (const row of rows) {
                                const selfEntityInfo = toSelfEntity.getData(row, pathToSelfEntity);
                                if (selfEntityInfo) {
                                    const selfEntityIds = selfEntityInfo!.map(
                                        (info) => {
                                            assert(info.entity === this.config.self.entity);
                                            return info.data.id as string
                                        }
                                    );
                                    const uniqSelfEntityIds = uniq(selfEntityIds);
                                    assert(uniqSelfEntityIds.length === 1, '同一行数据不可能关联在两行selfEntity上');
                                    selfEntityIdDict[row.id!] = uniqSelfEntityIds[0];
                                }
                            }
                            return selfEntityIdDict;
                        };

                        if (!this.pushAccessMap[entity as string]) {
                            this.pushAccessMap[entity as string] = [{
                                projection: projectionMerged,
                                groupByUsers,
                                groupBySelfEntity,
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
                                groupBySelfEntity,
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
                this.trySynchronizeOpers(context);
                // 内部自主处理triggerData，因此不需要让triggerExecutor处理
                throw new OakMakeSureByMySelfException();
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

    getSyncRoutine(): FreeRoutine<ED, Cxt> {
        return {
            name: 'checkpoint routine for sync',
            routine: async (context) => {
                this.trySynchronizeOpers(context);
                return {};
            },
        };
    }

    getSelfEndpoint(): EndpointItem<ED, Cxt> {
        return {
            name: this.config.self.endpoint || 'sync',
            method: 'post',
            params: ['entity', 'entityId'],
            fn: async (context, params, headers, req, body): Promise<{
                successIds: string[],
                redundantIds: string[],
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
                const redundantIds = [] as string[];
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
                    ele => ele.$$seq$$ <= maxBornAt
                );
                const freshOpers = opers.filter(
                    ele => ele.$$seq$$ as number > maxBornAt
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
                                redundantIds.push(...ids);
                            }
                        })(),
                        (async () => {
                            for (const freshOper of freshOpers) {
                                // freshOpers是按$$seq$$序产生的
                                const { id, targetEntity, action, data, $$seq$$, filter } = freshOper;
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
                                        bornAt: $$seq$$,
                                    };
                                    await context.operate(targetEntity, operation, {});
                                    successIds.push(id);
                                    maxBornAt = $$seq$$;
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
                    redundantIds,
                };
            }
        };
    }
}