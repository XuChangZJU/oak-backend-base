import { analyzeActionDefDict } from "oak-domain/lib/store/actionDef";
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { AppLoader as GeneralAppLoader, Trigger, Checker, Aspect, RowStore, Context, EntityDict } from "oak-domain/lib/types";
import { DbStore } from "./DbStore";
import generalAspectDict from 'oak-common-aspect/lib/index';
import { MySQLConfiguration } from 'oak-db/lib/MySQL/types/Configuration';

function initTriggers<ED extends EntityDict & BaseEntityDict, Cxt extends Context<ED>>(dbStore: DbStore<ED, Cxt>, path: string) {
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
}


export class AppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends Context<ED>> extends GeneralAppLoader<ED, Cxt> {
    private dbStore: DbStore<ED, Cxt>;
    private aspectDict: Record<string, Aspect<ED, Cxt>>;
    private contextBuilder: (scene?: string) => (store: RowStore<ED, Cxt>) => Cxt;
    constructor(path: string, contextBuilder: (scene?: string) => (store: RowStore<ED, Cxt>) => Cxt, dbConfig: MySQLConfiguration) {
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
        const context = this.contextBuilder()(this.dbStore);
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

    getStore(): RowStore<ED, Cxt> {
        return this.dbStore;
    }
}