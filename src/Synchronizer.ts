import { EntityDict, StorageSchema, EndpointItem } from 'oak-domain/lib/types';
import { VolatileTrigger } from 'oak-domain/lib/types/Trigger';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { SyncConfigWrapper, SyncEntityDef } from './types/Sync';
import { assert } from 'console';


export default class Synchronizer<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> {
    private config: SyncConfigWrapper<ED>;
    private schema: StorageSchema<ED>;

    private analyzeConfig() {
        const { config, schema } = this;
        const { remotes } = config;

        const analyzeSyncEntityDef = (defs: SyncEntityDef<ED, keyof ED>[]) => {
            const pushEntityDefs = defs.filter(ele => ele.direction === 'push');
            const pushEntities = pushEntityDefs.map(ele => ele.entity);

            // push相关联的entity，在发生操作时，需要将操作推送到远端
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

                    const def = pushEntityDefs.find(
                        ele => ele.entity === oper.targetEntity!
                    )!;
                    const { entity, path, relationName, direction } = def;

                    // 要找到对应的所有需要推送的node对象信息
                    


                    return 1;
                }
            }
        };

        remotes.forEach(
            (remote) => analyzeSyncEntityDef(remote.syncEntities)
        );
    }

    constructor(config: SyncConfigWrapper<ED>, schema: StorageSchema<ED>) {
        this.config = config;
        this.schema = schema;
    }

    /**
     * 根据sync的定义，生成对应的 commit triggers
     * @returns 
     */
    getSyncTriggers(): Array<VolatileTrigger<ED, keyof ED, Cxt>> {

        return [];
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