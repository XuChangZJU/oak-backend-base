"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbStore = void 0;
const oak_db_1 = require("oak-db");
const TriggerExecutor_1 = require("oak-domain/lib/store/TriggerExecutor");
const RelationAuth_1 = require("oak-domain/lib/store/RelationAuth");
class DbStore extends oak_db_1.MysqlStore {
    executor;
    relationAuth;
    constructor(storageSchema, contextBuilder, mysqlConfiguration, actionCascadeGraph, relationCascadeGraph) {
        super(storageSchema, mysqlConfiguration);
        this.executor = new TriggerExecutor_1.TriggerExecutor((scene) => contextBuilder(scene)(this));
        this.relationAuth = new RelationAuth_1.RelationAuth(actionCascadeGraph, relationCascadeGraph, storageSchema);
        this.initRelationAuthTriggers(contextBuilder);
    }
    /**
     * relationAuth中需要缓存一些维表的数据
     */
    async initRelationAuthTriggers(contextBuilder) {
        const context = await contextBuilder()(this);
        const freeActionAuths = await this.select('freeActionAuth', {
            data: {
                id: 1,
                deActions: 1,
                destEntity: 1,
            },
        }, context, {
            dontCollect: true,
        });
        this.relationAuth.setFreeActionAuths(freeActionAuths);
        const directActionAuths = await this.select('directActionAuth', {
            data: {
                id: 1,
                rootEntity: 1,
                path: 1,
                deActions: 1,
                destEntity: 1,
            },
        }, context, {
            dontCollect: true,
        });
        this.relationAuth.setDirectionActionAuths(directActionAuths);
        await context.commit();
        const triggers = this.relationAuth.getAuthDataTriggers();
        triggers.forEach((trigger) => this.registerTrigger(trigger));
    }
    async cascadeUpdateAsync(entity, operation, context, option) {
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, operation, context, option);
        }
        await this.relationAuth.checkRelationAsync(entity, operation, context);
        const result = await super.cascadeUpdateAsync(entity, operation, context, option);
        if (!option.blockTrigger) {
            await this.executor.postOperation(entity, operation, context, option);
        }
        return result;
    }
    async operate(entity, operation, context, option) {
        const autoCommit = !context.getCurrentTxnId();
        let result;
        if (autoCommit) {
            await context.begin();
        }
        try {
            result = await super.operate(entity, operation, context, option);
        }
        catch (err) {
            await context.rollback();
            throw err;
        }
        if (autoCommit) {
            await context.commit();
        }
        return result;
    }
    async select(entity, selection, context, option) {
        const autoCommit = !context.getCurrentTxnId();
        if (autoCommit) {
            await context.begin();
        }
        let result;
        // select的trigger应加在根select之前，cascade的select不加处理
        Object.assign(selection, {
            action: 'select',
        });
        await this.relationAuth.checkRelationAsync(entity, selection, context);
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, selection, context, option);
        }
        try {
            result = await super.select(entity, selection, context, option);
            if (!option.blockTrigger) {
                await this.executor.postOperation(entity, selection, context, option, result);
            }
        }
        catch (err) {
            await context.rollback();
            throw err;
        }
        if (autoCommit) {
            await context.commit();
        }
        return result;
    }
    async count(entity, selection, context, option) {
        const autoCommit = !context.getCurrentTxnId();
        let result;
        if (autoCommit) {
            await context.begin();
        }
        try {
            const selection2 = Object.assign({
                action: 'select',
            }, selection);
            await this.relationAuth.checkRelationAsync(entity, selection2, context);
            if (!option.blockTrigger) {
                await this.executor.preOperation(entity, selection2, context, option);
            }
            result = await super.count(entity, selection, context, option);
            /*  count应该不存在后trigger吧
            if (!option.blockTrigger) {
                await this.executor.postOperation(entity, selection2, context, option);
            } */
        }
        catch (err) {
            await context.rollback();
            throw err;
        }
        if (autoCommit) {
            await context.commit();
        }
        return result;
    }
    registerTrigger(trigger) {
        this.executor.registerTrigger(trigger);
    }
    registerChecker(checker) {
        this.executor.registerChecker(checker);
    }
}
exports.DbStore = DbStore;
