import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { AppLoader as GeneralAppLoader, EntityDict, OpRecord } from "oak-domain/lib/types";
import { DbStore } from "./DbStore";
import { AsyncContext } from "oak-domain/lib/store/AsyncRowStore";
import { IncomingHttpHeaders, IncomingMessage } from 'http';
import { Namespace } from 'socket.io';
export declare class AppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends AsyncContext<ED>> extends GeneralAppLoader<ED, Cxt> {
    private dbStore;
    private aspectDict;
    private externalDependencies;
    private dataSubscriber?;
    private contextBuilder;
    private requireSth;
    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, ns?: Namespace);
    initTriggers(): void;
    startWatchers(): void;
    mount(initialize?: true): Promise<void>;
    unmount(): Promise<void>;
    execAspect(name: string, contextString?: string, params?: any): Promise<{
        opRecords: OpRecord<ED>[];
        result: any;
        message?: string;
    }>;
    initialize(dropIfExists?: boolean): Promise<void>;
    getStore(): DbStore<ED, Cxt>;
    getEndpoints(): [string, "get" | "post" | "put" | "delete", string, (params: Record<string, string>, headers: IncomingHttpHeaders, req: IncomingMessage, body?: any) => Promise<any>][];
    startTimers(): void;
    execStartRoutines(): Promise<void>;
    execRoutine(routine: (context: Cxt) => Promise<void>): Promise<void>;
}
