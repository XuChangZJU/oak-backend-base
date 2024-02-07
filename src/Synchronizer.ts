import { EntityDict, StorageSchema, EndpointItem } from 'oak-domain/lib/types';
import { VolatileTrigger } from 'oak-domain/lib/types/Trigger';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { destructRelationPath, destructDirectPath } from 'oak-domain/lib/utils/relationPath';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { RemotePushInfo, SyncConfigWrapper, RemotePullInfo, SelfEncryptInfo } from './types/Sync';
import { assert } from 'console';
import { uniq } from 'oak-domain/lib/utils/lodash';

const OAK_SYNC_HEADER_ITEM = 'oak-sync-remote-id';

type Channel<ED extends EntityDict & BaseEntityDict> = {
    remoteMaxTimestamp?: number;                            // 远端已经接受的最大时间戳
    queue: Array<{
        resolve: () => void;
        reject: (err: any) => void;
        oper: Partial<ED['oper']['Schema']>;
    }>;            // 要推送的oper队列
    api: string;                                            // 推送的api
    lastPushTimestamp?: number;                             // 最后一次推送的时间戳
    handler?: ReturnType<typeof setTimeout>;                // 推送定时器
};


async function pushRequestOnChannel<ED extends EntityDict & BaseEntityDict>(channel: Channel<ED>, selfEncryptInfo: SelfEncryptInfo) {
    const { queue, api } = channel;
    channel.queue = [];
    channel.lastPushTimestamp = Date.now();
    channel.handler = undefined;

    const opers = queue.map(ele => ele.oper);
    try {
        // todo 加密
        const res = await fetch(api, {
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                [OAK_SYNC_HEADER_ITEM]: selfEncryptInfo.id,
            },
            body: JSON.stringify(opers),
        });

        if (res.status !== 200) {
            throw new Error(`访问api「${api}」的结果不是200。「${res.status}」`);
        }
        const json = await res.json();

        const { timestamp, error } = json;
        if (error) {
            throw new Error(`访问api「${api}」的结果出错，是${error}`);
        }
        if (!channel.remoteMaxTimestamp || channel.remoteMaxTimestamp < timestamp) {
            channel.remoteMaxTimestamp = timestamp;
        }

        queue.forEach(
            (ele) => ele.resolve()
        );
    }
    catch (err: any) {
        queue.forEach(
            ({ reject }) => reject(err)
        );
    }
}

export default class Synchronizer<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    private config: SyncConfigWrapper<ED>;
    private schema: StorageSchema<ED>;
    private selfEncryptInfo?: SelfEncryptInfo;
    private remotePullInfoMap: Record<string, Record<string, RemotePullInfo>> = {};

    private remotePushChannel: Record<string, Channel<ED>> = {};

    // 将产生的oper推送到远端Node。注意要尽量在本地阻止重复推送
    private async pushOper(
        oper: Partial<ED['oper']['Schema']>,
        userIds: string[],
        getRemoteAccessInfo: (userId: string) => Promise<RemotePushInfo>,
        endpoint?: string) {
        await Promise.all(
            userIds.map(
                async (userId) => {
                    if (!this.remotePushChannel[userId]) {
                        const { url } = await getRemoteAccessInfo(userId);
                        this.remotePushChannel[userId] = {
                            // todo 规范化
                            api: `${url}/endpoint/${endpoint || 'sync'}`,
                            queue: [],
                        };
                    }
                    const channel = this.remotePushChannel[userId];
                    if (channel.remoteMaxTimestamp && oper.bornAt as number < channel.remoteMaxTimestamp) {
                        // 说明已经同步过了
                        return;
                    }

                    const waiter = new Promise<void>(
                        (resolve, reject) => {
                            channel.queue.push({
                                oper,
                                resolve,
                                reject
                            });
                        }
                    );
                    if (!channel.handler) {
                        channel.handler = setTimeout(async () => {
                            assert(this.selfEncryptInfo);
                            await pushRequestOnChannel(channel, this.selfEncryptInfo!);
                        }, 1000);       // 1秒钟集中同步一次
                    }

                    await waiter;
                }
            )
        );
    }

    private async loadPublicKey() {
        this.selfEncryptInfo = await this.config.self.getSelfEncryptInfo();
    }

    private makeCreateOperTrigger() {
        const { config } = this;
        const { remotes, self } = config;

        // 根据remotes定义，建立从entity到需要同步的远端结点信息的Map
        const pushAccessMap: Record<string, Array<{
            projection: ED[keyof ED]['Selection']['data'];                          // 从entity上取到相关user需要的projection
            getUserIds: (rows: Partial<ED[keyof ED]['Schema']>[]) => string[];      // 从取得的行中获得userId的逻辑
            getRemotePushInfo: (userId: string) => Promise<RemotePushInfo>;     // 根据userId获得相应push远端的信息
            endpoint?: string;                                                      // 远端接收endpoint的url
        }>> = {};
        remotes.forEach(
            (remote) => {
                const { getRemotePushInfo, syncEntities, endpoint } = remote;
                const pushEntityDefs = syncEntities.filter(ele => ele.direction === 'push');
                const pushEntities = pushEntityDefs.map(ele => ele.entity);
                pushEntities.forEach(
                    (entity) => {
                        const def = syncEntities.find(ele => ele.entity === entity)!;
                        const { path, relationName, recursive } = def;

                        const {
                            projection,
                            getData
                        } = relationName ? destructRelationPath(this.schema, entity, path, {
                            relation: {
                                name: relationName,
                            }
                        }, recursive) : destructDirectPath(this.schema, entity, path, recursive);

                        const getUserIds = (rows: Partial<ED[keyof ED]['Schema']>[]) => {
                            const urs = rows.map(
                                (row) => getData(row)
                            ).flat();
                            return uniq(
                                urs.map(
                                    ele => ele.userId!
                                )
                            );
                        };

                        if (!pushAccessMap[entity as string]) {
                            pushAccessMap[entity as string] = [{
                                projection,
                                getUserIds,
                                getRemotePushInfo,
                                endpoint,
                            }];
                        }
                        else {
                            pushAccessMap[entity as string].push({
                                projection,
                                getUserIds,
                                getRemotePushInfo,
                                endpoint,
                            });
                        }
                    }
                )
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
                        $$createAt$$: 1,
                    },
                    filter: {
                        id: ids[0],
                    }
                }, { dontCollect: true });
                const { operatorId, targetEntity, operEntity$oper: operEntities } = oper;
                const entityIds = operEntities!.map(
                    ele => ele.entityId!
                );

                const pushNodes = pushAccessMap[targetEntity!];
                if (pushNodes) {
                    await Promise.all(
                        pushNodes.map(
                            async ({ projection, getUserIds, getRemotePushInfo: getRemoteAccessInfo, endpoint }) => {
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
                                }, { dontCollect: true });

                                // userId就是需要发送给远端的user，但是要将本次操作的user过滤掉（他是操作的产生者）
                                const userIds = getUserIds(rows).filter(
                                    (ele) => ele !== operatorId
                                );

                                if (userIds.length > 0) {
                                    await this.pushOper(oper, userIds, getRemoteAccessInfo, endpoint);
                                }
                                return undefined;
                            }
                        )
                    );

                    return entityIds.length * pushNodes.length;
                }
                return 0;
            }
        };

        return createOperTrigger;
    }

    constructor(config: SyncConfigWrapper<ED>, schema: StorageSchema<ED>) {
        this.config = config;
        this.schema = schema;
        this.loadPublicKey();
    }

    /**
     * 根据sync的定义，生成对应的 commit triggers
     * @returns 
     */
    getSyncTriggers() {
        return [this.makeCreateOperTrigger()] as Array<VolatileTrigger<ED, keyof ED, Cxt>>;
    }

    private async checkOperationConsistent(entity: keyof ED, ids: string[], bornAt: number) {

    }

    getSelfEndpoint(): EndpointItem<ED, Cxt> {
        return {
            name: this.config.self.endpoint || 'sync',
            method: 'post',
            params: ['entity'],
            fn: async (context, params, headers, req, body) => {
                // body中是传过来的oper数组信息
                const { entity } = params;
                const {[OAK_SYNC_HEADER_ITEM]: id} = headers;
                
                try {
                    // todo 这里先缓存，不考虑本身同步相关信息的更新
                    if (!this.remotePullInfoMap[entity]) {
                        this.remotePullInfoMap[entity] = {};
                    }
                    if (!this.remotePullInfoMap[entity]![id as string]) {
                        const { getRemotePullInfo } = this.config.remotes.find(ele => ele.entity === entity)!;
                        this.remotePullInfoMap[entity]![id as string] = await getRemotePullInfo(id as string);
                    }
                    
                    const pullInfo = this.remotePullInfoMap[entity][id as string];
                    const { userId, algorithm, publicKey } = pullInfo;
                    // todo 解密
    
                    // 如果本次同步中有bornAt比本用户操作的最大的bornAt要小，则说明是重复更新，直接返回
                    const [ maxHisOper ] = await context.select('oper', {
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
                    
                    const opers = body as ED['oper']['Schema'][];
                    const legalOpers = maxHisOper ? opers.filter(
                        ele => ele.bornAt > maxHisOper.bornAt!
                    ) : opers;
    
                    if (legalOpers.length > 0) {                    
                        for (const oper of legalOpers) {
                            const { id, targetEntity, action, data, bornAt, operEntity$oper: operEntities } = oper;
                            const ids = operEntities!.map(ele => ele.id);
    
                            this.checkOperationConsistent(targetEntity, ids, bornAt as number);
                            const operation: ED[keyof ED]['Operation'] = {
                                id,
                                data,
                                action,
                                filter: {
                                    id: {
                                        $in: ids,
                                    },
                                },
                                bornAt: bornAt as number,
                            };
                            await context.operate(targetEntity, operation, {});
                        }
                        // 因为legalOpers就是排好序的，所以直接返回最后一项的bornAt
                        return {
                            timestamp: legalOpers[legalOpers.length - 1].bornAt,
                        };
                    }
                    else {
                        assert(maxHisOper);
                        return {
                            timestamp: maxHisOper.bornAt,
                        };
                    }
                }
                catch (err) {
                    return {
                        error: JSON.stringify(err),
                    };
                }
            }
        };
    }
}