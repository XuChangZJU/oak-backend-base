import { groupBy } from 'oak-domain/lib/utils/lodash';
import { combineFilters } from 'oak-domain/lib/store/filter';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { EntityDict, OperationResult, VolatileTrigger, Trigger, OperateOption } from 'oak-domain/lib/types';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import { getClusterInfo } from './cluster/env';

import { AppLoader } from './AppLoader';
import assert from 'assert';
import { DbStore } from './DbStore';
import { Namespace } from 'socket.io';
import { io, Socket } from 'socket.io-client';

export class ClusterAppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends AppLoader<ED, Cxt> {
    protected socket: Socket;
    private csTriggers: Record<string, 1>;

    private connect() {
        const { instanceId } = getClusterInfo()!;
        this.socket.on('connect', () => {
            const csTriggerNames = Object.keys(this.csTriggers).map(
                ele => `${ele}-${instanceId}`
            );
            if (csTriggerNames.length > 0) {
                this.socket.emit('sub', csTriggerNames);
            }
        });
        this.socket.on('disconnect', () => {
            const csTriggerNames = Object.keys(this.csTriggers).map(
                ele => `${ele}-${instanceId}`
            );
            if (csTriggerNames.length > 0) {
                this.socket.connect();
            }
        });
        this.socket.on('data', async (entity: keyof ED, name: string, ids: string[], cxtStr: string, option: OperateOption) => {            
            const context = await this.makeContext(cxtStr);
            await context.begin();
            try {
                await this.dbStore.execVolatileTrigger(entity, name, ids, context, option);
                await context.commit();
            }
            catch (err) {
                await context.rollback();
                console.error('在集群环境下，处理来自其它实例的trigger数据，execVolatileTrigger异常', entity, name, ids, option, err);
            }
        });

        this.socket.connect();
    }

    private sub(name: string) {
        const { instanceId } = getClusterInfo()!;
        assert(!this.csTriggers[name], `命名为${name}的trigger出现了多次，请检查`);
        this.csTriggers[name] = 1;
        if (this.socket.connected) {
            this.socket.emit('sub', [`${name}-${instanceId}`]);
        }
        else {
            this.socket.connect();
        }
    }

    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, nsDs: Namespace, nsServer: Namespace, socketPath: string) {
        super(path, contextBuilder, nsDs, nsServer);
        this.dbStore.setOnVolatileTrigger(
            async (entity, trigger, ids, cxtStr, option) => {
                const execLocal = async (ids2: string[]) => {
                    const context = await this.makeContext(cxtStr);
                    await context.begin();
                    try {
                        await this.dbStore.execVolatileTrigger(entity, trigger.name, ids2, context, option);
                        await context.commit();
                    }
                    catch (err) {
                        await context.rollback();
                        console.error('execVolatileTrigger异常', entity, trigger.name, ids2, option, err);
                    }
                };
                if (trigger.cs) {
                    // 如果是cluster sensative的触发器，需要发送到相应的instance上被处理
                    const context = await this.makeContext();
                    const rows = await context.select(entity, {
                        data: {
                            id: 1,
                            $$seq$$: 1,
                        },
                        filter: {
                            id: { $in: ids },
                        }
                    }, { dontCollect: true });
                    await context.commit();

                    const { instanceCount, instanceId } = getClusterInfo();
                    const grouped = groupBy(rows, (ele) => ele.$$seq$$! % instanceCount!);
                    for (const seqMod in grouped) {
                        const ids2 = grouped[seqMod].map(ele => ele.id!);
                        if (parseInt(seqMod) === instanceId) {
                            await execLocal(ids2);
                        }
                        else {
                            this.dataSubscriber!.publishVolatileTrigger(entity, trigger.name, seqMod, ids2, cxtStr, option);
                        }
                    }
                }
                else {
                    await execLocal(ids);
                }
            }
        );
        const { name } = nsServer;
        const socketUrl = `http://localhost:${process.env.PM2_PORT || 8080}${name}`;
        this.socket = io(socketUrl, {
            path: socketPath,
        });
        this.connect();
        this.csTriggers = {};
    }

    protected registerTrigger(trigger: Trigger<ED, keyof ED, Cxt>): void {
        // 如果是cluster sensative的trigger，注册到socket事件上
        if (trigger.when === 'commit' && (<VolatileTrigger<ED, keyof ED, Cxt>>trigger).cs) {
            const { name } = trigger;
            this.sub(name);
        }
        this.dbStore.registerTrigger(trigger);
    }

    protected operateInWatcher<T extends keyof ED>(entity: T, operation: ED[T]['Update'], context: Cxt): Promise<OperationResult<ED>> {
        const { instanceCount, instanceId } = getClusterInfo()!;
        assert(instanceCount && typeof instanceId === 'number');
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
        assert(instanceCount && typeof instanceId === 'number');
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