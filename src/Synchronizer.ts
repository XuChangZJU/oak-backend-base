import { EntityDict, StorageSchema, EndpointItem } from 'oak-domain/lib/types';
import { VolatileTrigger } from 'oak-domain/lib/types/Trigger';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { destructRelationPath, destructDirectPath } from 'oak-domain/lib/utils/relationPath';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { RemoteAccessInfo, SyncConfigWrapper, Algorithm } from './types/Sync';
import { assert } from 'console';
import { uniq } from 'oak-domain/lib/utils/lodash';


export default class Synchronizer<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    private config: SyncConfigWrapper<ED>;
    private schema: StorageSchema<ED>;

    // 将产生的oper推送到远端Node。注意要尽量在本地阻止重复推送
    private async pushOper(
        oper: Partial<ED['oper']['Schema']>,
        userIds: string[],
        getRemoteAccessInfo: (userId: string) => Promise<RemoteAccessInfo>,
        privateKey: string,
        algorithm: Algorithm,
        endpoint?: string) {

    }

    private makeCreateOperTrigger() {
        const { config } = this;
        const { remotes, self } = config;

        // 根据remotes定义，建立从entity到需要同步的远端结点信息的Map
        const pushAccessMap: Record<string, Array<{
            projection: ED[keyof ED]['Selection']['data'];                          // 从entity上取到相关user需要的projection
            getUserIds: (rows: Partial<ED[keyof ED]['Schema']>[]) => string[];      // 从取得的行中获得userId的逻辑
            getRemoteAccessInfo: (userId: string) => Promise<RemoteAccessInfo>;     // 根据userId获得相应push远端的信息
            endpoint?: string;                                                      // 远端接收endpoint的url
        }>> = {};
        remotes.forEach(
            (remote) => {
                const { getRemoteAccessInfo, syncEntities, endpoint } = remote;
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
                                getRemoteAccessInfo,
                                endpoint,
                            }];
                        }
                        else {
                            pushAccessMap[entity as string].push({
                                projection,
                                getUserIds,
                                getRemoteAccessInfo,
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
                    },
                    filter: {
                        id: ids[0],
                    }
                }, { dontCollect: true });
                const { operatorId, targetEntity, operEntity$oper: operEntities } = oper;
                const entityIds = operEntities!.map(
                    ele => ele.entityId!
                );

                const { privateKey, algorithm } = await self.getSelfEncryptInfo();

                const pushNodes = pushAccessMap[targetEntity!];
                if (pushNodes) {
                    await Promise.all(
                        pushNodes.map(
                            async ({ projection, getUserIds, getRemoteAccessInfo, endpoint }) => {
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
                                    await this.pushOper(oper, userIds, getRemoteAccessInfo, privateKey, algorithm, endpoint);
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
            fn: async (context, params, headers, req, body) => {

            }
        };
    }
}