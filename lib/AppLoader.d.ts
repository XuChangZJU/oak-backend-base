import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { AppLoader as GeneralAppLoader, EntityDict } from "oak-domain/lib/types";
import { DbStore } from "./DbStore";
import { MySQLConfiguration } from 'oak-db/lib/MySQL/types/Configuration';
import { AsyncContext } from "oak-domain/lib/store/AsyncRowStore";
export declare class AppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends AsyncContext<ED>> extends GeneralAppLoader<ED, Cxt> {
    private dbStore;
    private aspectDict;
    private contextBuilder;
    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, dbConfig: MySQLConfiguration);
    mount(initialize?: true): Promise<void>;
    unmount(): Promise<void>;
    execAspect(name: string, context: Cxt, params?: any): Promise<any>;
    initialize(dropIfExists?: boolean): Promise<void>;
    getStore(): DbStore<ED, Cxt>;
}
