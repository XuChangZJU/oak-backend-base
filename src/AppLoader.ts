import { existsSync } from 'fs';
import { join } from 'path';
import { scheduleJob } from 'node-schedule';
import { OAK_EXTERNAL_LIBS_FILEPATH } from 'oak-domain/lib/compiler/env';
import { makeIntrinsicCTWs } from "oak-domain/lib/store/actionDef";
import { intersection, omit } from 'oak-domain/lib/utils/lodash';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { generateNewIdAsync } from 'oak-domain/lib/utils/uuid';
import { AppLoader as GeneralAppLoader, Trigger, Checker, Aspect, CreateOpResult, SyncConfig, EntityDict, Watcher, BBWatcher, WBWatcher, OpRecord, Routine, FreeRoutine, Timer, FreeTimer, StorageSchema, OperationResult } from "oak-domain/lib/types";
import { DbStore } from "./DbStore";
import generalAspectDict, { clearPorts, registerPorts } from 'oak-common-aspect/lib/index';
import { MySQLConfiguration } from 'oak-db/lib/MySQL/types/Configuration';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import { Endpoint, EndpointItem } from 'oak-domain/lib/types/Endpoint';
import assert from 'assert';
import { IncomingHttpHeaders, IncomingMessage } from 'http';
import { Server as SocketIoServer, Namespace } from 'socket.io';

import DataSubscriber from './cluster/DataSubscriber';
import { getClusterInfo } from './cluster/env';
import Synchronizer from './Synchronizer';


export class AppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends GeneralAppLoader<ED, Cxt> {
    protected dbStore: DbStore<ED, Cxt>;
    private aspectDict: Record<string, Aspect<ED, Cxt>>;
    private externalDependencies: string[];
    protected dataSubscriber?: DataSubscriber<ED, Cxt>;
    protected synchronizers?: Synchronizer<ED, Cxt>[];
    protected contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>;

    private requireSth(filePath: string): any {
        const depFilePath = join(this.path, filePath);
        let sth: any;
        if (existsSync(`${depFilePath}.js`)) {
            sth = require(join(this.path, filePath)).default;
        }
        const sthExternal = this.externalDependencies.map(
            ele => {
                const depFilePath = join(this.path, 'node_modules', ele, filePath);
                if (existsSync(`${depFilePath}.js`)) {
                    return require(depFilePath).default
                }
            }
        ).filter(
            ele => !!ele
        );

        if (!sth) {
            if (sthExternal.length > 0 && sthExternal[0] instanceof Array) {
                sth = [];
            }
            else {
                sth = {};
            }
        }

        if (sth instanceof Array) {
            sthExternal.forEach(
                (sth2, idx) => {
                    assert(sth2 instanceof Array, `${join(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象不是数组，与项目对应路径的输出不一致`);
                    sth.push(...sth2);
                }
            );
            return sth;
        }

        assert(typeof sth === 'object');
        const sthOut: Record<string, any> = {};
        sthExternal.forEach(
            (sth2, idx) => {
                assert(typeof sth2 === 'object' && !(sth2 instanceof Array), `${join(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象不是非数组对象，与项目对应路径的输出不一致`);
                const inter = intersection(Object.keys(sthOut), Object.keys(sth2));
                if (inter.length > 0) {
                    console.warn(`${join(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象中的key值【${inter.join(',')}】与其它对应路径输出的key值有冲突，请仔细检查避免错误`);
                    inter.forEach(
                        (ele) => {
                            if (sth2[ele] instanceof Array && sthOut[ele]) {
                                assert(sthOut[ele] instanceof Array, `${join(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象的${ele}键值是数组，但之前的相应对象的${ele}却不是，请仔细检查以避免错误`);
                                console.warn(`${join(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象中的key值【${ele}】与其它对应路径输出的key值【${ele}】将以数组格式进行合并，请仔细检查避免错误`);
                                sth2[ele].push(...sthOut[ele]);
                            }
                            else if (!(sth2[ele] instanceof Array) && sthOut[ele]) {
                                assert(!(sthOut[ele] instanceof Array), `${join(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象的${ele}键值不是数组，但之前的相应对象的${ele}却是，请仔细检查以避免错误`);
                                console.warn(`${join(this.path, 'node_modules', this.externalDependencies[idx], filePath)}中的default输出对象中的key值【${ele}】将对与其它对应路径输出的key值【${ele}】进行覆盖，请仔细检查避免错误`);
                            }
                        }
                    )
                }
                Object.assign(sthOut, sth2);
            }
        );

        const inter = intersection(Object.keys(sthOut), Object.keys(sth));
        if (inter.length > 0) {
            inter.forEach(
                (ele) => {
                    if (sth[ele] instanceof Array && sthOut[ele]) {
                        assert(sthOut[ele] instanceof Array, `项目${filePath}中的default输出对象的${ele}键值是数组，但之前的相应对象的${ele}却不是，请仔细检查以避免错误`);
                        console.warn(`项目${filePath}中的default输出对象中的key值【${ele}】与其它引用包该路径输出的key值【${ele}】将以数组格式进行合并，请仔细检查避免错误`);
                        sth[ele].push(...sthOut[ele]);
                    }
                    else if (!(sth[ele] instanceof Array) && sthOut[ele]) {
                        assert(!(sthOut[ele] instanceof Array), `项目${filePath}中的default输出对象的${ele}键值不是数组，但之前的相应对象的${ele}却是，请仔细检查以避免错误`);
                        console.warn(`项目${filePath}中的default输出对象中的key值【${ele}】将对其它引用包该路径输出的key值【${ele}】进行覆盖，请仔细检查避免错误`);
                    }
                }
            )
        }
        Object.assign(sthOut, sth);
        return sthOut;
    }

    protected async makeContext(cxtStr?: string, headers?: IncomingHttpHeaders) {
        const context = await this.contextBuilder(cxtStr)(this.dbStore);
        context.clusterInfo = getClusterInfo();
        context.headers = headers;

        return context;
    }

    /**
     * 后台启动的configuration，统一放在这里读取
     */
    private getConfiguration() {
        const dbConfigFile = join(this.path, 'configuration', 'mysql.json');
        const dbConfig = require(dbConfigFile);
        const syncConfigFile = join(this.path, 'lib', 'configuration', 'sync.js');
        const syncConfigs = existsSync(syncConfigFile) && require(syncConfigFile).default;

        return {
            dbConfig: dbConfig as MySQLConfiguration,
            syncConfigs: syncConfigs as SyncConfig<ED, Cxt>[] | undefined,
        };
    }

    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, ns?: Namespace, nsServer?: Namespace) {
        super(path);
        const { dbConfig } = this.getConfiguration();
        const { storageSchema } = require(`${path}/lib/oak-app-domain/Storage`);
        const { authDeduceRelationMap, selectFreeEntities, updateFreeDict } = require(`${path}/lib/config/relation`)
        this.externalDependencies = require(OAK_EXTERNAL_LIBS_FILEPATH(join(path, 'lib')));
        this.aspectDict = Object.assign({}, generalAspectDict, this.requireSth('lib/aspects/index'));
        this.dbStore = new DbStore<ED, Cxt>(storageSchema, (cxtStr) => this.makeContext(cxtStr), dbConfig, authDeduceRelationMap, selectFreeEntities, updateFreeDict);
        if (ns) {
            this.dataSubscriber = new DataSubscriber(ns, (scene) => this.contextBuilder(scene)(this.dbStore), nsServer);
        }

        this.contextBuilder = (scene) => async (store) => {
            const context = await contextBuilder(scene)(store);

            const originCommit = context.commit;
            context.commit = async () => {
                const { eventOperationMap, opRecords } = context;
                await originCommit.call(context);

                // 注入在提交后向dataSubscribe发送订阅的事件
                if (this.dataSubscriber) {
                    Object.keys(eventOperationMap).forEach(
                        (event) => {
                            const ids = eventOperationMap[event];

                            const opRecordsToPublish = (opRecords as CreateOpResult<ED, keyof ED>[]).filter(
                                (ele) => !!ele.id && ids.includes(ele.id)
                            );
                            assert(opRecordsToPublish.length === ids.length, '要推送的事件的operation数量不足，请检查确保');
                            this.dataSubscriber!.publishEvent(event, opRecordsToPublish, context.getSubscriberId());
                        }
                    );
                }
            };

            return context;
        }
    }

    protected registerTrigger(trigger: Trigger<ED, keyof ED, Cxt>) {
        this.dbStore.registerTrigger(trigger);
    }

    initTriggers() {
        const triggers = this.requireSth('lib/triggers/index');
        const checkers = this.requireSth('lib/checkers/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);

        const { triggers: adTriggers, checkers: adCheckers } = makeIntrinsicCTWs(this.dbStore.getSchema(), ActionDefDict);

        triggers.forEach(
            (trigger: Trigger<ED, keyof ED, Cxt>) => this.registerTrigger(trigger)
        );

        adTriggers.forEach(
            (trigger) => this.registerTrigger(trigger)
        );

        checkers.forEach(
            (checker: Checker<ED, keyof ED, Cxt>) => this.dbStore.registerChecker(checker)
        );

        adCheckers.forEach(
            (checker) => this.dbStore.registerChecker(checker)
        );

        if (this.synchronizers) {
            // 同步数据到远端结点通过commit trigger来完成
            for (const synchronizer of this.synchronizers) {
                const syncTriggers = synchronizer.getSyncTriggers();
                syncTriggers.forEach(
                    (trigger) => this.registerTrigger(trigger)
                );
            }
        }
    }

    async mount(initialize?: true) {
        const { path } = this;
        if (!initialize) {
            const { syncConfigs } = this.getConfiguration();

            if (syncConfigs) {
                this.synchronizers = syncConfigs.map(
                    config => new Synchronizer(config, this.dbStore.getSchema())
                );
            }

            this.initTriggers();
        }
        const { importations, exportations } = require(`${path}/lib/ports/index`);
        registerPorts(importations || [], exportations || []);
        this.dbStore.connect();
    }

    async unmount() {
        clearPorts();
        this.dbStore.disconnect();
    }

    async execAspect(name: string, headers?: IncomingHttpHeaders, contextString?: string, params?: any): Promise<{
        opRecords: OpRecord<ED>[];
        result: any;
        message?: string;
    }> {
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

    async initialize(dropIfExists?: boolean) {
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
                    await this.dbStore.operate(entity as keyof ED, {
                        data: rows,
                        action: 'create',
                    } as any, context, {
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

    getStore(): DbStore<ED, Cxt> {
        return this.dbStore;
    }

    getEndpoints(prefix: string) {
        const endpoints: Record<string, Endpoint<ED, Cxt>> = this.requireSth('lib/endpoints/index');
        const endPointRouters: Array<[EndpointItem<ED, Cxt>['name'], EndpointItem<ED, Cxt>['method'], string, (params: Record<string, string>, headers: IncomingHttpHeaders, req: IncomingMessage, body?: any) => Promise<any>]> = [];
        const endPointMap: Record<string, true> = {};

        const transformEndpointItem = (key: string, item: EndpointItem<ED, Cxt>) => {
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
            endPointRouters.push(
                [name, method, url, async (params, headers, req, body) => {
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
                }]
            );
        };
        for (const router in endpoints) {
            const item = endpoints[router];
            if (item instanceof Array) {
                item.forEach(
                    ele => transformEndpointItem(router, ele)
                );
            }
            else {
                transformEndpointItem(router, item);
            }
        }

        if (this.synchronizers) {
            this.synchronizers.forEach(
                (synchronizer) => {
                    const syncEp = synchronizer.getSelfEndpoint();
                    transformEndpointItem(syncEp.name, syncEp);
                }
            );
        }
        return endPointRouters;
    }

    protected operateInWatcher<T extends keyof ED>(entity: T, operation: ED[T]['Update'], context: Cxt) {
        return this.dbStore.operate(entity, operation, context, {
            dontCollect: true,
        });
    }

    protected selectInWatcher<T extends keyof ED>(entity: T, selection: ED[T]['Selection'], context: Cxt) {
        return this.dbStore.select(entity, selection, context, {
            dontCollect: true,
            blockTrigger: true,
        })
    }

    protected async execWatcher(watcher: Watcher<ED, keyof ED, Cxt>) {
        const context = await this.makeContext();
        await context.begin();
        let result: OperationResult<ED> | undefined;
        try {
            if (watcher.hasOwnProperty('actionData')) {
                const { entity, action, filter, actionData } = <BBWatcher<ED, keyof ED>>watcher;
                const filter2 = typeof filter === 'function' ? await filter() : filter;
                const data = typeof actionData === 'function' ? await (actionData)() : actionData;
                result = await this.operateInWatcher(entity, {
                    id: await generateNewIdAsync(),
                    action,
                    data,
                    filter: filter2
                }, context);
            }
            else {
                const { entity, projection, fn, filter } = <WBWatcher<ED, keyof ED, Cxt>>watcher;
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

        const { watchers: adWatchers } = makeIntrinsicCTWs(this.dbStore.getSchema(), ActionDefDict);
        const totalWatchers = (<Watcher<ED, keyof ED, Cxt>[]>watchers).concat(adWatchers);

        let count = 0;
        const execOne = async (watcher: Watcher<ED, keyof ED, Cxt>, start: number) => {
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
        const timers: Timer<ED, keyof ED, Cxt>[] = this.requireSth('lib/timers/index');
        for (const timer of timers) {
            const { cron, name } = timer;
            scheduleJob(name, cron, async (date) => {
                const start = Date.now();
                console.log(`定时器【${name}】开始执行，时间是【${date.toLocaleTimeString()}】`);

                if (timer.hasOwnProperty('entity')) {
                    try {
                        const result = await this.execWatcher(timer as Watcher<ED, keyof ED, Cxt>);
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
                        const { timer: timerFn } = timer as FreeTimer<ED, Cxt>;
                        const result = await timerFn(context);
                        console.log(`定时器【${name}】执行成功，耗时${Date.now() - start}毫秒，结果是【${result}】`);
                        await context.commit();
                    }
                    catch (err) {
                        console.warn(`定时器【${name}】执行失败，耗时${Date.now() - start}毫秒，错误是`, err);
                        await context.rollback();
                    }
                }
            })
        }
    }

    async execStartRoutines() {
        const routines: Routine<ED, keyof ED, Cxt>[] = this.requireSth('lib/routines/start');
        for (const routine of routines) {
            if (routine.hasOwnProperty('entity')) {
                const start = Date.now();
                try {
                    const result = await this.execWatcher(routine as Watcher<ED, keyof ED, Cxt>);
                    console.warn(`例程【${routine.name}】执行成功，耗时${Date.now() - start}毫秒，结果是`, result);
                }
                catch (err) {
                    console.warn(`例程【${routine.name}】执行失败，耗时${Date.now() - start}毫秒，错误是`, err);
                    throw err;
                }
            }
            else {
                const { name, routine: routineFn } = routine as FreeRoutine<ED, Cxt>;
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

    async execRoutine(routine: (context: Cxt) => Promise<void>) {
        const context = await this.makeContext();

        await routine(context);
    }
}