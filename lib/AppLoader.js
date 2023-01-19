"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppLoader = void 0;
const tslib_1 = require("tslib");
const node_schedule_1 = require("node-schedule");
const actionDef_1 = require("oak-domain/lib/store/actionDef");
const checkers_1 = require("oak-domain/lib/checkers");
const triggers_1 = require("oak-domain/lib/triggers");
const uuid_1 = require("oak-domain/lib/utils/uuid");
const types_1 = require("oak-domain/lib/types");
const DbStore_1 = require("./DbStore");
const index_1 = tslib_1.__importStar(require("oak-common-aspect/lib/index"));
function initTriggers(dbStore, path) {
    const triggers = require(`${path}/lib/triggers/index`).default;
    const checkers = require(`${path}/lib/checkers/index`).default;
    const authDict = require(`${path}/lib/auth/index`).default;
    const { ActionDefDict } = require(`${path}/lib/oak-app-domain/ActionDefDict`);
    const { triggers: adTriggers, checkers: adCheckers } = (0, actionDef_1.analyzeActionDefDict)(dbStore.getSchema(), ActionDefDict);
    triggers.forEach((trigger) => dbStore.registerTrigger(trigger));
    adTriggers.forEach((trigger) => dbStore.registerTrigger(trigger));
    checkers.forEach((checker) => dbStore.registerChecker(checker));
    adCheckers.forEach((checker) => dbStore.registerChecker(checker));
    const dynamicCheckers = (0, checkers_1.createDynamicCheckers)(dbStore.getSchema(), authDict);
    dynamicCheckers.forEach((checker) => dbStore.registerChecker(checker));
    const dynamicTriggers = (0, triggers_1.createDynamicTriggers)(dbStore.getSchema());
    dynamicTriggers.forEach((trigger) => dbStore.registerTrigger(trigger));
}
function startWatchers(dbStore, path, contextBuilder) {
    const watchers = require(`${path}/lib/watchers/index`).default;
    const { ActionDefDict } = require(`${path}/lib/oak-app-domain/ActionDefDict`);
    const { watchers: adWatchers } = (0, actionDef_1.analyzeActionDefDict)(dbStore.getSchema(), ActionDefDict);
    const totalWatchers = watchers.concat(adWatchers);
    let count = 0;
    const doWatchers = async () => {
        count++;
        const start = Date.now();
        const context = await contextBuilder()(dbStore);
        for (const w of totalWatchers) {
            await context.begin();
            try {
                if (w.hasOwnProperty('actionData')) {
                    const { entity, action, filter, actionData } = w;
                    const filter2 = typeof filter === 'function' ? filter() : filter;
                    const data = typeof actionData === 'function' ? await actionData() : actionData; // 这里有个奇怪的编译错误，不理解 by Xc
                    const result = await dbStore.operate(entity, {
                        id: await (0, uuid_1.generateNewIdAsync)(),
                        action,
                        data,
                        filter: filter2
                    }, context, {
                        dontCollect: true,
                    });
                    console.log(`执行了watcher【${w.name}】，结果是：`, result);
                }
                else {
                    const { entity, projection, fn, filter } = w;
                    const filter2 = typeof filter === 'function' ? await filter() : filter;
                    const projection2 = typeof projection === 'function' ? await projection() : projection;
                    const rows = await dbStore.select(entity, {
                        data: projection2,
                        filter: filter2,
                    }, context, {
                        dontCollect: true,
                        blockTrigger: true,
                    });
                    const result = await fn(context, rows);
                    console.log(`执行了watcher【${w.name}】，结果是：`, result);
                }
                await context.commit();
            }
            catch (err) {
                await context.rollback();
                console.error(`执行了watcher【${w.name}】，发生错误：`, err);
            }
        }
        const duration = Date.now() - start;
        console.log(`第${count}次执行watchers，共执行${watchers.length}个，耗时${duration}毫秒`);
        setTimeout(() => doWatchers(), 120000);
    };
    doWatchers();
}
class AppLoader extends types_1.AppLoader {
    dbStore;
    aspectDict;
    contextBuilder;
    constructor(path, contextBuilder, dbConfig) {
        super(path);
        const { storageSchema } = require(`${path}/lib/oak-app-domain/Storage`);
        this.aspectDict = Object.assign({}, index_1.default, require(`${path}/lib/aspects/index`).default);
        this.dbStore = new DbStore_1.DbStore(storageSchema, contextBuilder, dbConfig);
        this.contextBuilder = contextBuilder;
    }
    async mount(initialize) {
        const { path } = this;
        if (!initialize) {
            initTriggers(this.dbStore, path);
        }
        const { importations, exportations } = require(`${path}/lib/ports/index`);
        (0, index_1.registerPorts)(importations || [], exportations || []);
        this.dbStore.connect();
    }
    async unmount() {
        (0, index_1.clearPorts)();
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
        const data = require(`${this.path}/lib/data/index`).default;
        const context = await this.contextBuilder()(this.dbStore);
        await context.begin();
        for (const entity in data) {
            let rows = data[entity];
            if (entity === 'area') {
                //  对area暂时处理一下
                rows = require('./data/area.json');
            }
            if (rows.length > 0) {
                await this.dbStore.operate(entity, {
                    data: rows,
                    action: 'create',
                }, context, {
                    dontCollect: true,
                    dontCreateOper: true,
                });
                console.log(`data in ${entity} initialized!`);
            }
        }
        await context.commit();
        this.dbStore.disconnect();
    }
    getStore() {
        return this.dbStore;
    }
    startWatchers() {
        startWatchers(this.dbStore, this.path, this.contextBuilder);
    }
    startTimers() {
        const timers = require(`${this.path}/lib/timers/index`).default;
        for (const timer of timers) {
            const { cron, fn, name } = timer;
            (0, node_schedule_1.scheduleJob)(name, cron, async (date) => {
                const start = Date.now();
                const context = await this.contextBuilder()(this.dbStore);
                await context.begin();
                console.log(`定时器【${name}】开始执行，时间是【${date.toLocaleTimeString()}】`);
                try {
                    const result = await fn(context);
                    console.log(`定时器【${name}】执行完成，耗时${Date.now() - start}毫秒，结果是【${result}】`);
                    await context.commit();
                }
                catch (err) {
                    console.warn(`定时器【${name}】执行失败，耗时${Date.now() - start}毫秒，错误是`, err);
                    await context.rollback();
                }
            });
        }
    }
    async execStartRoutines() {
        const routines = require(`${this.path}/lib/routines/start`).default;
        for (const routine of routines) {
            const { name, fn } = routine;
            const context = await this.contextBuilder()(this.dbStore);
            const start = Date.now();
            await context.begin();
            try {
                const result = await fn(context);
                console.log(`例程【${name}】执行完成，耗时${Date.now() - start}毫秒，结果是【${result}】`);
                await context.commit();
            }
            catch (err) {
                console.warn(`例程【${name}】执行失败，耗时${Date.now() - start}毫秒，错误是`, err);
                await context.rollback();
            }
        }
    }
}
exports.AppLoader = AppLoader;
