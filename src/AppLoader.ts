import { existsSync } from 'fs';
import { join } from 'path';
import { scheduleJob } from 'node-schedule';
import { OAK_EXTERNAL_LIBS_FILEPATH } from 'oak-domain/lib/compiler/env';
import { makeIntrinsicCTWs } from "oak-domain/lib/store/actionDef";
import { intersection } from 'oak-domain/lib/utils/lodash';
import { createDynamicCheckers } from 'oak-domain/lib/checkers';
import { createDynamicTriggers } from 'oak-domain/lib/triggers';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { generateNewIdAsync } from 'oak-domain/lib/utils/uuid';
import { AppLoader as GeneralAppLoader, Trigger, Checker, Aspect, RowStore, Context, EntityDict, Watcher, BBWatcher, WBWatcher } from "oak-domain/lib/types";
import { DbStore } from "./DbStore";
import generalAspectDict, { clearPorts, registerPorts } from 'oak-common-aspect/lib/index';
import { MySQLConfiguration } from 'oak-db/lib/MySQL/types/Configuration';
import { AsyncContext } from "oak-domain/lib/store/AsyncRowStore";
import { Endpoint } from 'oak-domain/lib/types/Endpoint';
import assert from 'assert';


export class AppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends AsyncContext<ED>> extends GeneralAppLoader<ED, Cxt> {
    private dbStore: DbStore<ED, Cxt>;
    private aspectDict: Record<string, Aspect<ED, Cxt>>;
    private externalDependencies: string[];
    private contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>;

    private requireSth(filePath: string): any {
        const sth = require(join(this.path, filePath)).default;
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

    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, dbConfig: MySQLConfiguration) {
        super(path);
        const { storageSchema } = require(`${path}/lib/oak-app-domain/Storage`);
        const { ActionCascadePathGraph, RelationCascadePathGraph, selectFreeEntities, createFreeEntities, updateFreeEntities, deducedRelationMap } = require(`${path}/lib/oak-app-domain/Relation`);
        this.externalDependencies = require(OAK_EXTERNAL_LIBS_FILEPATH(join(path, 'lib')));
        this.aspectDict = Object.assign({}, generalAspectDict, this.requireSth('lib/aspects/index'));
        this.dbStore = new DbStore<ED, Cxt>(storageSchema, contextBuilder, dbConfig, ActionCascadePathGraph, RelationCascadePathGraph, deducedRelationMap,
            selectFreeEntities, createFreeEntities, updateFreeEntities);
        this.contextBuilder = contextBuilder;
    }

    initTriggers() {
        const triggers = this.requireSth('lib/triggers/index');
        const checkers = this.requireSth('lib/checkers/index');
        const authDict = this.requireSth('lib/auth/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);
    
        const { triggers: adTriggers, checkers: adCheckers } = makeIntrinsicCTWs(this.dbStore.getSchema(), ActionDefDict);
        triggers.forEach(
            (trigger: Trigger<ED, keyof ED, Cxt>) => this.dbStore.registerTrigger(trigger)
        );
        adTriggers.forEach(
            (trigger) => this.dbStore.registerTrigger(trigger)
        );
        checkers.forEach(
            (checker: Checker<ED, keyof ED, Cxt>) => this.dbStore.registerChecker(checker)
        );
        adCheckers.forEach(
            (checker) => this.dbStore.registerChecker(checker)
        );    
    }

    startWatchers() {
        const watchers = this.requireSth('lib/watchers/index');
        const { ActionDefDict } = require(`${this.path}/lib/oak-app-domain/ActionDefDict`);
    
        const { watchers: adWatchers } = makeIntrinsicCTWs(this.dbStore.getSchema(), ActionDefDict);
        const totalWatchers = (<Watcher<ED, keyof ED, Cxt>[]>watchers).concat(adWatchers);
    
        let count = 0;
        const doWatchers = async () => {
            count++;
            const start = Date.now();
            const context = await this.contextBuilder()(this.dbStore);
            for (const w of totalWatchers) {
                await context.begin();
                try {
                    if (w.hasOwnProperty('actionData')) {
                        const { entity, action, filter, actionData } = <BBWatcher<ED, keyof ED>>w;
                        const filter2 = typeof filter === 'function' ? await filter() : filter;
                        const data = typeof actionData === 'function' ? await (actionData as any)() : actionData;        // 这里有个奇怪的编译错误，不理解 by Xc
                        const result = await this.dbStore.operate(entity, {
                            id: await generateNewIdAsync(),
                            action,
                            data,
                            filter: filter2
                        }, context, {
                            dontCollect: true,
                        });
    
                        console.log(`执行了watcher【${w.name}】，结果是：`, result);
                    }
                    else {
                        const { entity, projection, fn, filter } = <WBWatcher<ED, keyof ED, Cxt>>w;
                        const filter2 = typeof filter === 'function' ? await filter() : filter;
                        const projection2 = typeof projection === 'function' ? await (projection as Function)() : projection;
                        const rows = await this.dbStore.select(entity, {
                            data: projection2 as any,
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

    async mount(initialize?: true) {
        const { path } = this;
        if (!initialize) {
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

    async execAspect(name: string, context: Cxt, params?: any): Promise<any> {
        const fn = this.aspectDict[name];
        if (!fn) {
            throw new Error(`不存在的接口名称: ${name}`);
        }
        return await fn(params, context);
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
                    console.log(`data in ${entity} initialized!`);
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

    getEndpoints(): Record<string, Endpoint<ED, Cxt>> {
        const endpoints = this.requireSth('lib/endpoints/index');
        return endpoints;
    }

    startTimers() {
        const timers = this.requireSth('lib/timers/index');
        for (const timer of timers) {
            const { cron, fn, name } = timer;
            scheduleJob(name, cron, async (date) => {
                const start = Date.now();
                const context = await this.contextBuilder()(this.dbStore);
                await context.begin();
                console.log(`定时器【${name}】开始执行，时间是【${date.toLocaleTimeString()}】`);
                try {
                    const result = await fn(context);
                    console.log(`定时器【${name}】执行完成，耗时${Date.now() - start}毫秒，结果是【${result}】`);
                    await context.commit();
                }
                catch(err) {
                    console.warn(`定时器【${name}】执行失败，耗时${Date.now() - start}毫秒，错误是`, err);
                    await context.rollback();
                }
            })
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

    async execRoutine(routine: (context: Cxt) => Promise<void>) {
        const context = await this.contextBuilder()(this.dbStore);
        await routine(context);        
    }
}