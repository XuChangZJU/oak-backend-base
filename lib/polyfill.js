"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const uuid_1 = require("uuid");
async function generateNewId(option) {
    if (option?.shuffle && process.env.NODE_ENV === 'development') {
        return (0, uuid_1.v4)();
    }
    return (0, uuid_1.v1)();
}
Object.assign(global, {
    generateNewId,
});
