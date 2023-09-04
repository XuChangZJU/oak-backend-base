"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppLoader = void 0;
const tslib_1 = require("tslib");
const fs_1 = require("fs");
const path_1 = require("path");
const node_schedule_1 = require("node-schedule");
const env_1 = require("oak-domain/lib/compiler/env");
const actionDef_1 = require("oak-domain/lib/store/actionDef");
const lodash_1 = require("oak-domain/lib/utils/lodash");
const uuid_1 = require("oak-domain/lib/utils/uuid");
const types_1 = require("oak-domain/lib/types");
const DbStore_1 = require("./DbStore");
const index_1 = tslib_1.__importStar(require("oak-common-aspect/lib/index"));
const assert_1 = tslib_1.__importDefault(require("assert"));
const DataSubscriber_1 = tslib_1.__importDefault(require("./DataSubscriber"));
class AppLoader extends types_1.AppLoader {
    dbStore;
    aspectDict;
    externalDependencies;
    dataSubscriber;
    contextBuilder;
    requireSth(filePath) {
        const depFilePath = (0, path_1.join)(this.path, filePath);
        let sth;
        if ((0, fs_1.existsSync)(`${depFilePath}.js`)) {
            sth = require((0, path_1.join)(this.path, filePath)).default;
        }
        const sthExternal = this.externalDependencies.map(ele => {
            const depFilePath = (0, path_1.join)(this.path, 'node_modules', ele, filePath);
            if ((0, fs_1.existsSync)(`${depFilePath}.js`)) {
                return require(depFilePath).default;
            }
        }).filter(ele => !!ele);
        if (!sth) {
            if (sthExternal.length > 0 && sthExternal[0] instanceof Array) {
                sth = [];
            }
            else {
                sth = {};
            }
        }
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
                inter.forEach((ele) => {
                    if (sth2[ele] instanceof Array && sthOut[ele]) {
                        (0, assert_1.default)(sthOut[ele] instanceof Array, `${(0, path_1.join)(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象的${ele}键值是数组，但之前的相应对象的${ele}却不是，请仔细检查以避免错误`);
                        console.warn(`${(0, path_1.join)(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象中的key值【${ele}】与其它对应路径输出的key值【${ele}】将以数组格式进行合并，请仔细检查避免错误`);
                        sth2[ele].push(...sthOut[ele]);
                    }
                    else if (!(sth2[ele] instanceof Array) && sthOut[ele]) {
                        (0, assert_1.default)(!(sthOut[ele] instanceof Array), `${(0, path_1.join)(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象的${ele}键值不是数组，但之前的相应对象的${ele}却是，请仔细检查以避免错误`);
                        console.warn(`${(0, path_1.join)(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象中的key值【${ele}】将对与其它对应路径输出的key值【${ele}】进行覆盖，请仔细检查避免错误`);
                    }
                });
            }
            Object.assign(sthOut, sth2);
        });
        const inter = (0, lodash_1.intersection)(Object.keys(sthOut), Object.keys(sth));
        if (inter.length > 0) {
            inter.forEach((ele) => {
                if (sth[ele] instanceof Array && sthOut[ele]) {
                    (0, assert_1.default)(sthOut[ele] instanceof Array, `项目${filePath}中的default输出对象的${ele}键值是数组，但之前的相应对象的${ele}却不是，请仔细检查以避免错误`);
                    console.warn(`项目${filePath}中的default输出对象中的key值【${ele}】与其它引用包该路径输出的key值【${ele}】将以数组格式进行合并，请仔细检查避免错误`);
                    sth[ele].push(...sthOut[ele]);
                }
                else if (!(sth[ele] instanceof Array) && sthOut[ele]) {
                    (0, assert_1.default)(!(sthOut[ele] instanceof Array), `项目${filePath}中的default输出对象的${ele}键值不是数组，但之前的相应对象的${ele}却是，请仔细检查以避免错误`);
                    console.warn(`项目${filePath}中的default输出对象中的key值【${ele}】将对其它引用包该路径输出的key值【${ele}】进行覆盖，请仔细检查避免错误`);
                }
            });
        }
        Object.assign(sthOut, sth);
        return sthOut;
    }
    constructor(path, contextBuilder, io) {
        super(path);
        const dbConfig = require((0, path_1.join)(path, '/configuration/mysql.json'));
        const { storageSchema } = require(`${path}/lib/oak-app-domain/Storage`);
        const { ActionCascadePathGraph, RelationCascadePathGraph, selectFreeEntities, createFreeEntities, updateFreeEntities, deducedRelationMap } = require(`${path}/lib/oak-app-domain/Relation`);
        this.externalDependencies = require((0, env_1.OAK_EXTERNAL_LIBS_FILEPATH)((0, path_1.join)(path, 'lib')));
        this.aspectDict = Object.assign({}, index_1.default, this.requireSth('lib/aspects/index'));
        this.dbStore = new DbStore_1.DbStore(storageSchema, contextBuilder, dbConfig, ActionCascadePathGraph, RelationCascadePathGraph, deducedRelationMap, selectFreeEntities, createFreeEntities, updateFreeEntities);
        this.contextBuilder = contextBuilder;
        if (io) {
            this.dataSubscriber = new DataSubscriber_1.default(io, (scene) => this.contextBuilder(scene)(this.dbStore));
        }
    }
    initTriggers() {
        const triggers = this.requireSth('lib/triggers/index');
        const checkers = this.requireSth('lib/checkers/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);
        const { triggers: adTriggers, checkers: adCheckers } = (0, actionDef_1.makeIntrinsicCTWs)(this.dbStore.getSchema(), ActionDefDict);
        triggers.forEach((trigger) => this.dbStore.registerTrigger(trigger));
        adTriggers.forEach((trigger) => this.dbStore.registerTrigger(trigger));
        checkers.forEach((checker) => this.dbStore.registerChecker(checker));
        adCheckers.forEach((checker) => this.dbStore.registerChecker(checker));
    }
    startWatchers() {
        const watchers = this.requireSth('lib/watchers/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);
        const { watchers: adWatchers } = (0, actionDef_1.makeIntrinsicCTWs)(this.dbStore.getSchema(), ActionDefDict);
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
    async execAspect(name, contextString, params) {
        const context = await this.contextBuilder(contextString)(this.dbStore);
        const fn = this.aspectDict[name];
        if (!fn) {
            throw new Error(`不存在的接口名称: ${name}`);
        }
        await context.begin();
        try {
            const result = await fn(params, context);
            await context.commit();
            await context.refineOpRecords();
            return {
                opRecords: context.opRecords,
                message: context.getMessage(),
                result,
            };
        }
        catch (err) {
            await context.rollback();
            throw err;
        }
    }
    async initialize(dropIfExists) {
        await this.dbStore.initialize(dropIfExists);
        const data = this.requireSth('lib/data/index');
        const context = await this.contextBuilder()(this.dbStore);
        for (const entity in data) {
            let rows = data[entity];
            if (entity === 'area') {
                //  对area暂时处理一下
                rows = require('./data/area.json');
            }
            if (rows.length > 0) {
                await context.begin();
                try {
                    await this.dbStore.operate(entity, {
                        data: rows,
                        action: 'create',
                    }, context, {
                        dontCollect: true,
                        dontCreateOper: true,
                    });
                    await context.commit();
                    console.log(`data in ${entity} initialized, ${rows.length} rows inserted`);
                }
                catch (err) {
                    await context.rollback();
                    console.error(`data on ${entity} initilization failed!`);
                    throw err;
                }
            }
        }
        this.dbStore.disconnect();
    }
    getStore() {
        return this.dbStore;
    }
    getEndpoints() {
        const endpoints = this.requireSth('lib/endpoints/index');
        const endPointRouters = [];
        const endPointMap = {};
        const transformEndpointItem = (key, item) => {
            const { name, method, fn } = item;
            const k = `${key}-${name}-${method}`;
            if (endPointMap[k]) {
                throw new Error(`endpoint中，url为「${key}」、名为${name}的方法「${method}」存在重复定义`);
            }
            endPointMap[k] = true;
            endPointRouters.push([name, method, key, async (params, headers, req, body) => {
                    const context = await this.contextBuilder()(this.dbStore);
                    await context.begin();
                    try {
                        const result = await fn(context, params, headers, req, body);
                        await context.commit();
                        return result;
                    }
                    catch (err) {
                        await context.rollback();
                        console.error(`endpoint「${key}」方法「${method}」出错`, err);
                        throw err;
                    }
                }]);
        };
        for (const router in endpoints) {
            const item = endpoints[router];
            if (item instanceof Array) {
                item.forEach(ele => transformEndpointItem(router, ele));
            }
            else {
                transformEndpointItem(router, item);
            }
        }
        return endPointRouters;
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
    async execRoutine(routine) {
        const context = await this.contextBuilder()(this.dbStore);
        await routine(context);
    }
}
exports.AppLoader = AppLoader;
