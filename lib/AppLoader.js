"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppLoader = void 0;
const tslib_1 = require("tslib");
const actionDef_1 = require("oak-domain/lib/store/actionDef");
const checkers_1 = require("oak-domain/lib/checkers");
const triggers_1 = require("oak-domain/lib/triggers");
const types_1 = require("oak-domain/lib/types");
const DbStore_1 = require("./DbStore");
const index_1 = tslib_1.__importDefault(require("oak-common-aspect/lib/index"));
function initTriggers(dbStore, path) {
    const { triggers } = require(`${path}/lib/triggers/index`);
    const { checkers } = require(`${path}/lib/checkers/index`);
    const { ActionDefDict } = require(`${path}/lib/oak-app-domain/ActionDefDict`);
    const { triggers: adTriggers, checkers: adCheckers } = (0, actionDef_1.analyzeActionDefDict)(dbStore.getSchema(), ActionDefDict);
    triggers.forEach((trigger) => dbStore.registerTrigger(trigger));
    adTriggers.forEach((trigger) => dbStore.registerTrigger(trigger));
    checkers.forEach((checker) => dbStore.registerChecker(checker));
    adCheckers.forEach((checker) => dbStore.registerChecker(checker));
    const dynamicCheckers = (0, checkers_1.createDynamicCheckers)(dbStore.getSchema());
    dynamicCheckers.forEach((checker) => dbStore.registerChecker(checker));
    const dynamicTriggers = (0, triggers_1.createDynamicTriggers)(dbStore.getSchema());
    dynamicTriggers.forEach((trigger) => dbStore.registerTrigger(trigger));
}
class AppLoader extends types_1.AppLoader {
    dbStore;
    aspectDict;
    contextBuilder;
    constructor(path, contextBuilder, dbConfig) {
        super(path);
        const { storageSchema } = require(`${path}/lib/oak-app-domain/Storage`);
        this.aspectDict = Object.assign({}, index_1.default, require(`${path}/lib/aspects/index`).aspectDict);
        this.dbStore = new DbStore_1.DbStore(storageSchema, contextBuilder, dbConfig);
        this.contextBuilder = contextBuilder;
    }
    async mount(initialize) {
        const { path } = this;
        if (!initialize) {
            initTriggers(this.dbStore, path);
        }
        this.dbStore.connect();
    }
    async unmount() {
        this.dbStore.disconnect();
    }
    async execAspect(name, context, params) {
        const fn = this.aspectDict[name];
        if (!fn) {
            throw new Error(`不存在的接口名称: ${name}`);
        }
        return await fn(params, context);
    }
    async initialize(dropIfExists) {
        await this.dbStore.initialize(dropIfExists);
        const { data } = require(`${this.path}/lib/data/index`);
        const context = this.contextBuilder()(this.dbStore);
        await context.begin();
        for (const entity in data) {
            let rows = data[entity];
            if (entity === 'area') {
                //  对area暂时处理一下
                rows = require('./data/area.json');
            }
            await this.dbStore.operate(entity, {
                data: rows,
                action: 'create',
            }, context, {
                dontCollect: true,
                dontCreateOper: true,
            });
            console.log(`data in ${entity} initialized!`);
        }
        await context.commit();
        this.dbStore.disconnect();
    }
    getStore() {
        return this.dbStore;
    }
}
exports.AppLoader = AppLoader;
