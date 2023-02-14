"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppLoader = void 0;
const tslib_1 = require("tslib");
const fs_1 = require("fs");
const path_1 = require("path");
const node_schedule_1 = require("node-schedule");
const actionDef_1 = require("oak-domain/lib/store/actionDef");
const lodash_1 = require("oak-domain/lib/utils/lodash");
const checkers_1 = require("oak-domain/lib/checkers");
const triggers_1 = require("oak-domain/lib/triggers");
const uuid_1 = require("oak-domain/lib/utils/uuid");
const types_1 = require("oak-domain/lib/types");
const DbStore_1 = require("./DbStore");
const index_1 = tslib_1.__importStar(require("oak-common-aspect/lib/index"));
const assert_1 = tslib_1.__importDefault(require("assert"));
class AppLoader extends types_1.AppLoader {
    dbStore;
    aspectDict;
    externalDependencies;
    contextBuilder;
    requireSth(filePath) {
        const sth = require((0, path_1.join)(this.path, filePath)).default;
        const sthExternal = this.externalDependencies.map(ele => {
            const depFilePath = (0, path_1.join)(this.path, 'node_modules', ele, filePath);
            if ((0, fs_1.existsSync)(`${depFilePath}.js`)) {
                return require(depFilePath).default;
            }
        }).filter(ele => !!ele);
        if (sth instanceof Array) {
            sthExternal.forEach((sth2, idx) => {
                (0, assert_1.default)(sth2 instanceof Array, `${(0, path_1.join)(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象不是数组，与项目对应路径的输出不一致`);
                sth.push(...sth2);
            });
            return sth;
        }
        (0, assert_1.default)(typeof sth === 'object');
        const sthOut = {};
        sthExternal.forEach((sth2, idx) => {
            (0, assert_1.default)(typeof sth2 === 'object' && !(sth2 instanceof Array), `${(0, path_1.join)(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象不是非数组对象，与项目对应路径的输出不一致`);
            const inter = (0, lodash_1.intersection)(Object.keys(sthOut), Object.keys(sth2));
            if (inter.length > 0) {
                console.warn(`${(0, path_1.join)(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象中的key值【${inter.join(',')}】与其它对应路径输出的key值有冲突，请仔细检查避免错误`);
            }
            Object.assign(sthOut, sth2);
        });
        const inter = (0, lodash_1.intersection)(Object.keys(sthOut), Object.keys(sth));
        (0, assert_1.default)(inter.length === 0, `项目${filePath}中的default输出与第三方库中的输出在键值${inter.join(',')}上冲突，请处理`);
        return sthOut;
    }
    constructor(path, contextBuilder, dbConfig) {
        super(path);
        const { storageSchema } = require(`${path}/lib/oak-app-domain/Storage`);
        this.externalDependencies = require(`${path}/lib/config/externalDependencies`).default;
        this.aspectDict = Object.assign({}, index_1.default, this.requireSth('lib/aspects/index'));
        this.dbStore = new DbStore_1.DbStore(storageSchema, contextBuilder, dbConfig);
        this.contextBuilder = contextBuilder;
    }
    initTriggers() {
        const triggers = this.requireSth('lib/triggers/index');
        const checkers = this.requireSth('lib/checkers/index');
        const authDict = this.requireSth('lib/auth/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);
        const { triggers: adTriggers, checkers: adCheckers } = (0, actionDef_1.analyzeActionDefDict)(this.dbStore.getSchema(), ActionDefDict);
        triggers.forEach((trigger) => this.dbStore.registerTrigger(trigger));
        adTriggers.forEach((trigger) => this.dbStore.registerTrigger(trigger));
        checkers.forEach((checker) => this.dbStore.registerChecker(checker));
        adCheckers.forEach((checker) => this.dbStore.registerChecker(checker));
        const dynamicCheckers = (0, checkers_1.createDynamicCheckers)(this.dbStore.getSchema(), authDict);
        dynamicCheckers.forEach((checker) => this.dbStore.registerChecker(checker));
        const dynamicTriggers = (0, triggers_1.createDynamicTriggers)(this.dbStore.getSchema());
        dynamicTriggers.forEach((trigger) => this.dbStore.registerTrigger(trigger));
    }
    startWatchers() {
        const watchers = this.requireSth('lib/watchers/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);
        const { watchers: adWatchers } = (0, actionDef_1.analyzeActionDefDict)(this.dbStore.getSchema(), ActionDefDict);
        const totalWatchers = watchers.concat(adWatchers);
        let count = 0;
        const doWatchers = async () => {
            count++;
            const start = Date.now();
            const context = await this.contextBuilder()(this.dbStore);
            for (const w of totalWatchers) {
                await context.begin();
                try {
                    if (w.hasOwnProperty('actionData')) {
                        const { entity, action, filter, actionData } = w;
                        const filter2 = typeof filter === 'function' ? await filter() : filter;
                        const data = typeof actionData === 'function' ? await actionData() : actionData; // 这里有个奇怪的编译错误，不理解 by Xc
                        const result = await this.dbStore.operate(entity, {
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
                        const rows = await this.dbStore.select(entity, {
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
    async mount(initialize) {
        const { path } = this;
        if (!initialize) {
            this.initTriggers();
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
        const data = this.requireSth('lib/data/index');
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
    getEndpoints() {
        const endpoints = this.requireSth('lib/endpoints/index');
        return endpoints;
    }
    startTimers() {
        const timers = this.requireSth('lib/timers/index');
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
        const routines = this.requireSth('lib/routines/start');
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
