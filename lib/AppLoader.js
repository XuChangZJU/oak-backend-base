"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppLoader = void 0;
const tslib_1 = require("tslib");
const fs_1 = require("fs");
const path_1 = require("path");
const node_schedule_1 = require("node-schedule");
const env_1 = require("oak-domain/lib/compiler/env");
const IntrinsicLogics_1 = require("oak-domain/lib/store/IntrinsicLogics");
const lodash_1 = require("oak-domain/lib/utils/lodash");
const uuid_1 = require("oak-domain/lib/utils/uuid");
const types_1 = require("oak-domain/lib/types");
const DbStore_1 = require("./DbStore");
const index_1 = tslib_1.__importStar(require("oak-common-aspect/lib/index"));
const assert_1 = tslib_1.__importDefault(require("assert"));
const DataSubscriber_1 = tslib_1.__importDefault(require("./cluster/DataSubscriber"));
const env_2 = require("./cluster/env");
const Synchronizer_1 = tslib_1.__importDefault(require("./Synchronizer"));
class AppLoader extends types_1.AppLoader {
    dbStore;
    aspectDict;
    externalDependencies;
    dataSubscriber;
    synchronizer;
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
    async makeContext(cxtStr, headers) {
        const context = await this.contextBuilder(cxtStr)(this.dbStore);
        context.clusterInfo = (0, env_2.getClusterInfo)();
        context.headers = headers;
        return context;
    }
    /**
     * 后台启动的configuration，统一放在这里读取
     */
    getConfiguration() {
        const dbConfigFile = (0, path_1.join)(this.path, 'configuration', 'mysql.json');
        const dbConfig = require(dbConfigFile);
        const syncConfigFile = (0, path_1.join)(this.path, 'lib', 'configuration', 'sync.js');
        const syncConfigs = (0, fs_1.existsSync)(syncConfigFile) && require(syncConfigFile).default;
        return {
            dbConfig: dbConfig,
            syncConfig: syncConfigs,
        };
    }
    constructor(path, contextBuilder, ns, nsServer) {
        super(path);
        const { dbConfig } = this.getConfiguration();
        const { storageSchema } = require(`${path}/lib/oak-app-domain/Storage`);
        const { authDeduceRelationMap, selectFreeEntities, updateFreeDict } = require(`${path}/lib/config/relation`);
        this.externalDependencies = require((0, env_1.OAK_EXTERNAL_LIBS_FILEPATH)((0, path_1.join)(path, 'lib')));
        this.aspectDict = Object.assign({}, index_1.default, this.requireSth('lib/aspects/index'));
        this.dbStore = new DbStore_1.DbStore(storageSchema, (cxtStr) => this.makeContext(cxtStr), dbConfig, authDeduceRelationMap, selectFreeEntities, updateFreeDict);
        if (ns) {
            this.dataSubscriber = new DataSubscriber_1.default(ns, (scene) => this.contextBuilder(scene)(this.dbStore), nsServer);
        }
        this.contextBuilder = (scene) => async (store) => {
            const context = await contextBuilder(scene)(store);
            const originCommit = context.commit;
            context.commit = async () => {
                const { eventOperationMap, opRecords } = context;
                await originCommit.call(context);
                // 注入在提交后向dataSubscribe发送订阅的事件
                if (this.dataSubscriber) {
                    Object.keys(eventOperationMap).forEach((event) => {
                        const ids = eventOperationMap[event];
                        const opRecordsToPublish = opRecords.filter((ele) => !!ele.id && ids.includes(ele.id));
                        (0, assert_1.default)(opRecordsToPublish.length === ids.length, '要推送的事件的operation数量不足，请检查确保');
                        this.dataSubscriber.publishEvent(event, opRecordsToPublish, context.getSubscriberId());
                    });
                }
            };
            return context;
        };
    }
    registerTrigger(trigger) {
        this.dbStore.registerTrigger(trigger);
    }
    initTriggers() {
        const triggers = this.requireSth('lib/triggers/index');
        const checkers = this.requireSth('lib/checkers/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);
        const { triggers: adTriggers, checkers: adCheckers } = (0, IntrinsicLogics_1.makeIntrinsicCTWs)(this.dbStore.getSchema(), ActionDefDict);
        triggers.forEach((trigger) => this.registerTrigger(trigger));
        adTriggers.forEach((trigger) => this.registerTrigger(trigger));
        checkers.forEach((checker) => this.dbStore.registerChecker(checker));
        adCheckers.forEach((checker) => this.dbStore.registerChecker(checker));
        if (this.synchronizer) {
            // 同步数据到远端结点通过commit trigger来完成            
            const syncTriggers = this.synchronizer.getSyncTriggers();
            syncTriggers.forEach((trigger) => this.registerTrigger(trigger));
        }
    }
    async mount(initialize) {
        const { path } = this;
        if (!initialize) {
            const { syncConfig: syncConfig } = this.getConfiguration();
            if (syncConfig) {
                this.synchronizer = new Synchronizer_1.default(syncConfig, this.dbStore.getSchema(), () => this.contextBuilder()(this.dbStore));
            }
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
    async execAspect(name, headers, contextString, params) {
        // 从aspect过来的，不能有空cxtString，以防被误判为root
        const context = await this.makeContext(contextString || '{}', headers);
        const fn = this.aspectDict[name];
        if (!fn) {
            throw new Error(`不存在的接口名称: ${name}`);
        }
        await context.begin();
        try {
            const result = await fn(params, context);
            await context.refineOpRecords();
            const { opRecords } = context;
            const message = context.getMessage();
            await context.commit();
            return {
                opRecords,
                message,
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
    getEndpoints(prefix) {
        const endpoints = this.requireSth('lib/endpoints/index');
        const endPointRouters = [];
        const endPointMap = {};
        const transformEndpointItem = (key, item) => {
            const { name, method, fn, params: itemParams } = item;
            const k = `${key}-${name}-${method}`;
            if (endPointMap[k]) {
                throw new Error(`endpoint中，url为「${key}」、名为${name}的方法「${method}」存在重复定义`);
            }
            endPointMap[k] = true;
            let url = `${prefix}/${key}`;
            if (itemParams) {
                for (const p of itemParams) {
                    url += `/:${p}`;
                }
            }
            endPointRouters.push([name, method, url, async (params, headers, req, body) => {
                    const context = await this.makeContext(undefined, headers);
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
        if (this.synchronizer) {
            const syncEp = this.synchronizer.getSelfEndpoint();
            transformEndpointItem(syncEp.name, syncEp);
        }
        return endPointRouters;
    }
    operateInWatcher(entity, operation, context) {
        return this.dbStore.operate(entity, operation, context, {
            dontCollect: true,
        });
    }
    selectInWatcher(entity, selection, context) {
        return this.dbStore.select(entity, selection, context, {
            dontCollect: true,
            blockTrigger: true,
        });
    }
    async execWatcher(watcher) {
        const context = await this.makeContext();
        await context.begin();
        let result;
        try {
            if (watcher.hasOwnProperty('actionData')) {
                const { entity, action, filter, actionData } = watcher;
                const filter2 = typeof filter === 'function' ? await filter() : filter;
                const data = typeof actionData === 'function' ? await (actionData)() : actionData;
                result = await this.operateInWatcher(entity, {
                    id: await (0, uuid_1.generateNewIdAsync)(),
                    action,
                    data,
                    filter: filter2
                }, context);
            }
            else {
                const { entity, projection, fn, filter } = watcher;
                const filter2 = typeof filter === 'function' ? await filter() : filter;
                const projection2 = typeof projection === 'function' ? await projection() : projection;
                const rows = await this.selectInWatcher(entity, {
                    data: projection2,
                    filter: filter2,
                }, context);
                if (rows.length > 0) {
                    result = await fn(context, rows);
                }
            }
            await context.commit();
            return result;
        }
        catch (err) {
            await context.rollback();
            throw err;
        }
    }
    startWatchers() {
        const watchers = this.requireSth('lib/watchers/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);
        const { watchers: adWatchers } = (0, IntrinsicLogics_1.makeIntrinsicCTWs)(this.dbStore.getSchema(), ActionDefDict);
        const totalWatchers = watchers.concat(adWatchers);
        let count = 0;
        const execOne = async (watcher, start) => {
            try {
                const result = await this.execWatcher(watcher);
                console.log(`执行watcher【${watcher.name}】成功，耗时【${Date.now() - start}】，结果是：`, result);
            }
            catch (err) {
                console.error(`执行watcher【${watcher.name}】失败，耗时【${Date.now() - start}】，结果是：`, err);
            }
        };
        const doWatchers = async () => {
            count++;
            const start = Date.now();
            for (const w of totalWatchers) {
                execOne(w, start);
            }
            const duration = Date.now() - start;
            console.log(`第${count}次执行watchers，共执行${watchers.length}个，耗时${duration}毫秒`);
            const now = Date.now();
            try {
                await this.dbStore.checkpoint(process.env.NODE_ENV === 'development' ? now - 30 * 1000 : now - 120 * 1000);
            }
            catch (err) {
                console.error(`执行了checkpoint，发生错误：`, err);
            }
            setTimeout(() => doWatchers(), 120000);
        };
        doWatchers();
    }
    startTimers() {
        const timers = this.requireSth('lib/timers/index');
        for (const timer of timers) {
            const { cron, name } = timer;
            (0, node_schedule_1.scheduleJob)(name, cron, async (date) => {
                const start = Date.now();
                console.log(`定时器【${name}】开始执行，时间是【${date.toLocaleTimeString()}】`);
                if (timer.hasOwnProperty('entity')) {
                    try {
                        const result = await this.execWatcher(timer);
                        console.log(`定时器【${name}】执行成功，耗时${Date.now() - start}毫秒】，结果是`, result);
                    }
                    catch (err) {
                        console.log(`定时器【${name}】执行成功，耗时${Date.now() - start}毫秒】，错误是`, err);
                    }
                }
                else {
                    const context = await this.makeContext();
                    await context.begin();
                    try {
                        const { timer: timerFn } = timer;
                        const result = await timerFn(context);
                        console.log(`定时器【${name}】执行成功，耗时${Date.now() - start}毫秒，结果是【${result}】`);
                        await context.commit();
                    }
                    catch (err) {
                        console.warn(`定时器【${name}】执行失败，耗时${Date.now() - start}毫秒，错误是`, err);
                        await context.rollback();
                    }
                }
            });
        }
    }
    async execStartRoutines() {
        const routines = this.requireSth('lib/routines/start');
        if (this.synchronizer) {
            const routine = this.synchronizer.getSyncRoutine();
            routines.push(routine);
        }
        for (const routine of routines) {
            if (routine.hasOwnProperty('entity')) {
                const start = Date.now();
                try {
                    const result = await this.execWatcher(routine);
                    console.warn(`例程【${routine.name}】执行成功，耗时${Date.now() - start}毫秒，结果是`, result);
                }
                catch (err) {
                    console.warn(`例程【${routine.name}】执行失败，耗时${Date.now() - start}毫秒，错误是`, err);
                    throw err;
                }
            }
            else {
                const { name, routine: routineFn } = routine;
                const context = await this.makeContext();
                const start = Date.now();
                await context.begin();
                try {
                    const result = await routineFn(context);
                    console.log(`例程【${name}】执行成功，耗时${Date.now() - start}毫秒，结果是【${result}】`);
                    await context.commit();
                }
                catch (err) {
                    console.warn(`例程【${name}】执行失败，耗时${Date.now() - start}毫秒，错误是`, err);
                    await context.rollback();
                    throw err;
                }
            }
        }
    }
    async execRoutine(routine) {
        const context = await this.makeContext();
        await routine(context);
    }
}
exports.AppLoader = AppLoader;
