import { RowStore } from 'oak-domain/lib/types';
import { GeneralRuntimeContext } from 'oak-general-business';
import { EntityDict } from 'oak-general-business/lib/general-app-domain';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';

export class Context<ED extends EntityDict & BaseEntityDict> extends GeneralRuntimeContext<ED> {
    static FromCxtStr(cxtStr?: string){
        const {
            token,
            applicationId,
            scene
        } = cxtStr ? GeneralRuntimeContext.fromString(cxtStr) : {
            token: undefined,
            applicationId: undefined,
            scene: undefined,
        };
        return <ED extends EntityDict & BaseEntityDict>(store: RowStore<ED, Context<ED>>) => {
            const context = new Context<ED>(store, applicationId);
            context.setScene(scene);
            context.setToken(token);
            return context;
        };
    }
}