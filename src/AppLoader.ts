import { analyzeActionDefDict } from "oak-domain/lib/store/actionDef";
import { createDynamicCheckers } from 'oak-domain/lib/checkers';
import { createDynamicTriggers } from 'oak-domain/lib/triggers';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { generateNewIdAsync } from 'oak-domain/lib/utils/uuid';
import { AppLoader as GeneralAppLoader, Trigger, Checker, Aspect, RowStore, Context, EntityDict, Watcher, BBWatcher, WBWatcher } from "oak-domain/lib/types";
import { DbStore } from "./DbStore";
import generalAspectDict from 'oak-common-aspect/lib/index';
import { MySQLConfiguration } from 'oak-db/lib/MySQL/types/Configuration';
import { AsyncContext } from "oak-domain/lib/store/AsyncRowStore";

function initTriggers<ED extends EntityDict & BaseEntityDict, Cxt extends AsyncContext<ED>>(dbStore: DbStore<ED, Cxt>, path: string) {
    const { triggers } = require(`${path}/lib/triggers/index`);
    const { checkers } = require(`${path}/lib/checkers/index`);
    const { ActionDefDict } = require(`${path}/lib/oak-app-domain/ActionDefDict`);

    const { triggers: adTriggers, checkers: adCheckers } = analyzeActionDefDict(dbStore.getSchema(), ActionDefDict);
    triggers.forEach(
        (trigger: Trigger<ED, keyof ED, Cxt>) => dbStore.registerTrigger(trigger)
    );
    adTriggers.forEach(
        (trigger) => dbStore.registerTrigger(trigger)
    );
    checkers.forEach(
        (checker: Checker<ED, keyof ED, Cxt>) => dbStore.registerChecker(checker)
    );
    adCheckers.forEach(
        (checker) => dbStore.registerChecker(checker)
    );

    const dynamicCheckers = createDynamicCheckers(dbStore.getSchema());
    dynamicCheckers.forEach(
        (checker) => dbStore.registerChecker(checker)
    );

    const dynamicTriggers = createDynamicTriggers(dbStore.getSchema());
    dynamicTriggers.forEach(
        (trigger) => dbStore.registerTrigger(trigger)
    );
}

function startWatchers<ED extends EntityDict & BaseEntityDict, Cxt extends AsyncContext<ED>>(
    dbStore: DbStore<ED, Cxt>,
    path: string,
    contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>
) {
    const { watchers } = require(`${path}/lib/watchers/index`);
    const { ActionDefDict } = require(`${path}/lib/oak-app-domain/ActionDefDict`);

    const { watchers: adWatchers } = analyzeActionDefDict(dbStore.getSchema(), ActionDefDict);
    const totalWatchers = (<Watcher<ED, keyof ED, Cxt>[]>watchers).concat(adWatchers);

    let count = 0;
    const doWatchers = async () => {
        count++;
        const start = Date.now();
        const context = await contextBuilder()(dbStore);
        for (const w of totalWatchers) {
            await context.begin();
            try {
                if (w.hasOwnProperty('actionData')) {
                    const { entity, action, filter, actionData } = <BBWatcher<ED, keyof ED>>w;
                    const filter2 = typeof filter === 'function' ? filter() : filter;
                    const data = typeof actionData === 'function' ? await (actionData as any)() : actionData;        // 这里有个奇怪的编译错误，不理解 by Xc
                    const result = await dbStore.operate(entity, {
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
                    const projection2 = typeof projection === 'function' ? await projection() : projection;
                    const rows = await dbStore.select(entity, {
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


export class AppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends AsyncContext<ED>> extends GeneralAppLoader<ED, Cxt> {
    private dbStore: DbStore<ED, Cxt>;
    private aspectDict: Record<string, Aspect<ED, Cxt>>;
    private contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>;
    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, dbConfig: MySQLConfiguration) {
        super(path);
        const { storageSchema } = require(`${path}/lib/oak-app-domain/Storage`);
        this.aspectDict = Object.assign({}, generalAspectDict, require(`${path}/lib/aspects/index`).aspectDict);
        this.dbStore = new DbStore<ED, Cxt>(storageSchema, contextBuilder, dbConfig);
        this.contextBuilder = contextBuilder;
    }

    async mount(initialize?: true) {
        const { path } = this;
        if (!initialize) {
            initTriggers(this.dbStore, path);
        }
        this.dbStore.connect();
    }

    async unmount() {
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

        const { data } = require(`${this.path}/lib/data/index`);
        const context = await this.contextBuilder()(this.dbStore);
        await context.begin();
        for (const entity in data) {
            let rows = data[entity];
            if (entity === 'area') {
                //  对area暂时处理一下
                rows = require('./data/area.json');
            }
            await this.dbStore.operate(entity as keyof ED, {
                data: rows,
                action: 'create',
            } as any, context, {
                dontCollect: true,
                dontCreateOper: true,
            });
            console.log(`data in ${entity} initialized!`);
        }
        await context.commit();
        this.dbStore.disconnect();
    }

    getStore(): DbStore<ED, Cxt> {
        return this.dbStore;
    }

    startWatchers() {
        startWatchers(this.dbStore, this.path, this.contextBuilder);
    }
}