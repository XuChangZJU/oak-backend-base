import { combineFilters } from 'oak-domain/lib/store/filter';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { EntityDict, OperationResult, VolatileTrigger, Trigger } from 'oak-domain/lib/types';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { getClusterInfo } from './cluster/env';

import { AppLoader } from './AppLoader';
import assert from 'assert';
import { DbStore } from './DbStore';
import { Namespace } from 'socket.io';

export class ClusterAppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends AppLoader<ED, Cxt> {
    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, ns?: Namespace) {
        super(path, contextBuilder, ns);
        this.dbStore.setOnVolatileTrigger(
            async (entity, trigger, ids, cxtStr, option) => {
                if (trigger.cs) {
                    // 如果是cluster sensative的触发器，需要发送到相应的instance上被处理
                }
                else {
                    const context = await this.contextBuilder(cxtStr)(this.dbStore);
                    await context.begin();
                    try {
                        await this.dbStore.execVolatileTrigger(entity, trigger.name, ids, context, option);
                        await context.commit();
                    }
                    catch (err) {
                        await context.rollback();
                        console.error('execVolatileTrigger异常', entity, trigger.name, ids, option, err);
                    }
                }
            }
        )
    }
    protected operateInWatcher<T extends keyof ED>(entity: T, operation: ED[T]['Update'], context: Cxt): Promise<OperationResult<ED>> {
        const { instanceCount, instanceId } = getClusterInfo()!;
        assert (instanceCount && typeof instanceId === 'number');
        const { filter } = operation;
        const filter2 = combineFilters<ED, T>(entity, this.dbStore.getSchema(), [filter, {
            $$seq$$: {
                $mod: [instanceCount, instanceId]
            }
        }]);
        return super.operateInWatcher(entity, {
            ...operation,
            filter: filter2,
        }, context);
    }

    protected selectInWatcher<T extends keyof ED>(entity: T, selection: ED[T]['Selection'], context: Cxt): Promise<Partial<ED[T]['Schema']>[]> {        
        const { instanceCount, instanceId } = getClusterInfo()!;
        assert (instanceCount && typeof instanceId === 'number');
        const { filter } = selection;
        const filter2 = combineFilters<ED, T>(entity, this.dbStore.getSchema(), [filter, {
            $$seq$$: {
                $mod: [instanceCount, instanceId]
            }
        }]);
        return super.selectInWatcher(entity, {
            ...selection,
            filter: filter2,
        }, context);
    }
}