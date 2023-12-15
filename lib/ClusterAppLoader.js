"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterAppLoader = void 0;
const tslib_1 = require("tslib");
const lodash_1 = require("oak-domain/lib/utils/lodash");
const filter_1 = require("oak-domain/lib/store/filter");
const env_1 = require("./cluster/env");
const AppLoader_1 = require("./AppLoader");
const assert_1 = tslib_1.__importDefault(require("assert"));
const socket_io_client_1 = require("socket.io-client");
class ClusterAppLoader extends AppLoader_1.AppLoader {
    socket;
    csTriggers;
    connect() {
        const { instanceId } = (0, env_1.getClusterInfo)();
        this.socket.on('connect', () => {
            const csTriggerNames = Object.keys(this.csTriggers).map(ele => `${ele}-${instanceId}`);
            if (csTriggerNames.length > 0) {
                this.socket.emit('sub', csTriggerNames);
            }
        });
        this.socket.on('disconnect', () => {
            const csTriggerNames = Object.keys(this.csTriggers).map(ele => `${ele}-${instanceId}`);
            if (csTriggerNames.length > 0) {
                this.socket.connect();
            }
        });
        this.socket.on('data', async (entity, name, ids, cxtStr, option) => {
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
    sub(name) {
        const { instanceId } = (0, env_1.getClusterInfo)();
        (0, assert_1.default)(!this.csTriggers[name], `命名为${name}的trigger出现了多次，请检查`);
        this.csTriggers[name] = 1;
        if (this.socket.connected) {
            this.socket.emit('sub', [`${name}-${instanceId}`]);
        }
        else {
            this.socket.connect();
        }
    }
    constructor(path, contextBuilder, nsDs, nsServer, socketPath) {
        super(path, contextBuilder, nsDs, nsServer);
        this.dbStore.setOnVolatileTrigger(async (entity, trigger, ids, cxtStr, option) => {
            const execLocal = async (ids2) => {
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
                const { instanceCount, instanceId } = (0, env_1.getClusterInfo)();
                const grouped = (0, lodash_1.groupBy)(rows, (ele) => ele.$$seq$$ % instanceCount);
                for (const seqMod in grouped) {
                    const ids2 = grouped[seqMod].map(ele => ele.id);
                    if (parseInt(seqMod) === instanceId) {
                        await execLocal(ids2);
                    }
                    else {
                        this.dataSubscriber.publishVolatileTrigger(entity, trigger.name, seqMod, ids2, cxtStr, option);
                    }
                }
            }
            else {
                await execLocal(ids);
            }
        });
        const { name } = nsServer;
        const socketUrl = `http://localhost:${process.env.PM2_PORT || 8080}${name}`;
        this.socket = (0, socket_io_client_1.io)(socketUrl, {
            path: socketPath,
        });
        this.connect();
        this.csTriggers = {};
    }
    registerTrigger(trigger) {
        // 如果是cluster sensative的trigger，注册到socket事件上
        if (trigger.when === 'commit' && trigger.cs) {
            const { name } = trigger;
            this.sub(name);
        }
        this.dbStore.registerTrigger(trigger);
    }
    operateInWatcher(entity, operation, context) {
        const { instanceCount, instanceId } = (0, env_1.getClusterInfo)();
        (0, assert_1.default)(instanceCount && typeof instanceId === 'number');
        const { filter } = operation;
        const filter2 = (0, filter_1.combineFilters)(entity, this.dbStore.getSchema(), [filter, {
                $$seq$$: {
                    $mod: [instanceCount, instanceId]
                }
            }]);
        return super.operateInWatcher(entity, {
            ...operation,
            filter: filter2,
        }, context);
    }
    selectInWatcher(entity, selection, context) {
        const { instanceCount, instanceId } = (0, env_1.getClusterInfo)();
        (0, assert_1.default)(instanceCount && typeof instanceId === 'number');
        const { filter } = selection;
        const filter2 = (0, filter_1.combineFilters)(entity, this.dbStore.getSchema(), [filter, {
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
exports.ClusterAppLoader = ClusterAppLoader;
