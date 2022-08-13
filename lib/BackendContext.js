"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Context = void 0;
const oak_general_business_1 = require("oak-general-business");
class Context extends oak_general_business_1.GeneralRuntimeContext {
    static FromCxtStr(cxtStr) {
        const { token, applicationId, scene } = cxtStr ? oak_general_business_1.GeneralRuntimeContext.fromString(cxtStr) : {
            token: undefined,
            applicationId: undefined,
            scene: undefined,
        };
        return (store) => {
            const context = new Context(store, applicationId);
            context.setScene(scene);
            context.setToken(token);
            return context;
        };
    }
}
exports.Context = Context;
