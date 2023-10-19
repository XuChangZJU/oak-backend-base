"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbStore = void 0;
const oak_db_1 = require("oak-db");
const TriggerExecutor_1 = require("oak-domain/lib/store/TriggerExecutor");
const RelationAuth_1 = require("oak-domain/lib/store/RelationAuth");
class DbStore extends oak_db_1.MysqlStore {
    executor;
    relationAuth;
    constructor(storageSchema, contextBuilder, mysqlConfiguration, authDeduceRelationMap, selectFreeEntities = [], updateFreeDict = {}) {
        super(storageSchema, mysqlConfiguration);
        this.executor = new TriggerExecutor_1.TriggerExecutor((scene) => contextBuilder(scene)(this));
        this.relationAuth = new RelationAuth_1.RelationAuth(storageSchema, authDeduceRelationMap, selectFreeEntities, updateFreeDict);
    }
    async cascadeUpdateAsync(entity, operation, context, option) {
        // 如果是在modi处理过程中，所有的trigger也可以延时到apply时再处理（这时候因为modi中的数据并不实际存在，处理会有问题）
        if (!option.blockTrigger && !option.modiParentEntity) {
            await this.executor.preOperation(entity, operation, context, option);
        }
        const result = await super.cascadeUpdateAsync(entity, operation, context, option);
        if (!option.blockTrigger && !option.modiParentEntity) {
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
            await this.relationAuth.checkRelationAsync(entity, operation, context);
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
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, selection, context, option);
        }
        if (!option.dontCollect) {
            await this.relationAuth.checkRelationAsync(entity, selection, context);
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
            // count不用检查权限，因为检查权限中本身要用到count
            // const selection2 = Object.assign({
            //     action: 'select',
            // }, selection) as ED[T]['Operation'];
            // await this.relationAuth.checkRelationAsync(entity, selection2, context);
            // if (!option.blockTrigger) {
            //     await this.executor.preOperation(entity, selection2, context, option);
            // }
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
    checkpoint(ts) {
        return this.executor.checkpoint(ts);
    }
}
exports.DbStore = DbStore;
