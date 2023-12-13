"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterAppLoader = void 0;
const tslib_1 = require("tslib");
const filter_1 = require("oak-domain/lib/store/filter");
const env_1 = require("./cluster/env");
const AppLoader_1 = require("./AppLoader");
const assert_1 = tslib_1.__importDefault(require("assert"));
const socket_io_client_1 = require("socket.io-client");
class ClusterAppLoader extends AppLoader_1.AppLoader {
    socket;
    constructor(path, contextBuilder, nsDs, nsServer, socketPath) {
        super(path, contextBuilder, nsDs);
        this.dbStore.setOnVolatileTrigger(async (entity, trigger, ids, cxtStr, option) => {
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
        });
        const { name } = nsServer;
        const socketUrl = `http://localhost:${process.env.PM2_PORT || 8080}${name}`;
        this.socket = (0, socket_io_client_1.io)(socketUrl, {
            path: socketPath,
        });
    }
    registerTrigger(trigger) {
        // 如果是cluster sensative的trigger，注册到socket事件上
        if (trigger.when === 'commit' && trigger.cs) {
            const { name } = trigger;
            throw new Error('uncompleted yet');
        }
        else {
            this.dbStore.registerTrigger(trigger);
        }
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
