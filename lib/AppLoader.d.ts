/// <reference types="node" />
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { AppLoader as GeneralAppLoader, EntityDict, OpRecord } from "oak-domain/lib/types";
import { DbStore } from "./DbStore";
import { BackendRuntimeContext } from 'oak-frontend-base';
import { IncomingHttpHeaders, IncomingMessage } from 'http';
import { Namespace } from 'socket.io';
import { ClusterInfo } from 'oak-domain/lib/types/Cluster';
export declare class AppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends GeneralAppLoader<ED, Cxt> {
    private dbStore;
    private aspectDict;
    private externalDependencies;
    private dataSubscriber?;
    private contextBuilder;
    private requireSth;
    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>, header?: IncomingHttpHeaders, clusterInfo?: ClusterInfo) => Promise<Cxt>, ns?: Namespace);
    initTriggers(): void;
    startWatchers(): void;
    mount(initialize?: true): Promise<void>;
    unmount(): Promise<void>;
    execAspect(name: string, header?: IncomingHttpHeaders, contextString?: string, params?: any): Promise<{
        opRecords: OpRecord<ED>[];
        result: any;
        message?: string;
    }>;
    initialize(dropIfExists?: boolean): Promise<void>;
    getStore(): DbStore<ED, Cxt>;
    getEndpoints(prefix: string): [string, "get" | "post" | "put" | "delete", string, (params: Record<string, string>, headers: IncomingHttpHeaders, req: IncomingMessage, body?: any) => Promise<any>][];
    startTimers(): void;
    execStartRoutines(): Promise<void>;
    execRoutine(routine: (context: Cxt) => Promise<void>): Promise<void>;
}
