"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbStore = void 0;
const oak_db_1 = require("oak-db");
const TriggerExecutor_1 = require("oak-domain/lib/store/TriggerExecutor");
class DbStore extends oak_db_1.MysqlStore {
    executor;
    constructor(storageSchema, contextBuilder, mysqlConfiguration) {
        super(storageSchema, mysqlConfiguration);
        this.executor = new TriggerExecutor_1.TriggerExecutor((scene) => contextBuilder(scene)(this));
    }
    async cascadeUpdate(entity, operation, context, option) {
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, operation, context, option);
        }
        const result = super.cascadeUpdate(entity, operation, context, option);
        if (!option.blockTrigger) {
            await this.executor.postOperation(entity, operation, context, option);
        }
        return result;
    }
    async cascadeSelect(entity, selection, context, option) {
        const selection2 = Object.assign({
            action: 'select',
        }, selection);
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, selection2, context, option);
        }
        const result = await super.cascadeSelect(entity, selection2, context, option);
        if (!option.blockTrigger) {
            await this.executor.postOperation(entity, selection2, context, option, result);
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
        try {
            result = await super.select(entity, selection, context, option);
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
