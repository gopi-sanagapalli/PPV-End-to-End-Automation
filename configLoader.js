"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEventConfig = loadEventConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function loadEventConfig(configFile, region) {
    var _a, _b, _c, _d, _e;
    // 1 Load base config
    const basePath = path.resolve('config/Wardley PPV config/Wardley_base.json');
    const base = JSON.parse(fs.readFileSync(basePath, 'utf-8'));
    // 2 Load flow config
    const flowPath = path.resolve(`config/${configFile}`);
    if (!fs.existsSync(flowPath)) {
        throw new Error(`Config file not found: ${flowPath}`);
    }
    const flow = JSON.parse(fs.readFileSync(flowPath, 'utf-8'));
    // 3 Deep merge flow overrides base
    const merged = deepMerge(base, flow);
    // 4 Validate region exists
    if (!((_a = merged.regions) === null || _a === void 0 ? void 0 : _a[region])) {
        const available = Object.keys((_b = merged.regions) !== null && _b !== void 0 ? _b : {}).join(', ');
        throw new Error(`Region "${region}" not found in ${configFile}\n` +
            `Available regions: ${available}`);
    }
    // 5 Flatten all layers
    const globalData = (_c = merged.global) !== null && _c !== void 0 ? _c : {};
    const regionData = merged.regions[region];
    const pageData = (_e = (_d = regionData.pages) !== null && _d !== void 0 ? _d : merged.pages) !== null && _e !== void 0 ? _e : {};
    const eventData = Object.assign(Object.assign(Object.assign(Object.assign({}, globalData), merged), regionData), { pages: pageData, REGION: region });
    // 6 Clean up nested objects
    delete eventData.regions;
    delete eventData.global;
    // 7 Resolve PPV_NAME placeholders
    return resolvePlaceholders(eventData);
}
function deepMerge(base, override) {
    const result = Object.assign({}, base);
    for (const key of Object.keys(override)) {
        if (override[key] !== null &&
            typeof override[key] === 'object' &&
            !Array.isArray(override[key]) &&
            base[key] !== undefined &&
            typeof base[key] === 'object') {
            result[key] = deepMerge(base[key], override[key]);
        }
        else {
            result[key] = override[key];
        }
    }
    return result;
}
function resolvePlaceholders(data) {
    const resolved = Object.assign({}, data);
    for (const key of Object.keys(resolved)) {
        if (typeof resolved[key] === 'string') {
            resolved[key] = resolved[key].replace(/\{\{(\w+)\}\}/g, (_, k) => { var _a; return (_a = resolved[k]) !== null && _a !== void 0 ? _a : `{{${k}}}`; });
        }
    }
    return resolved;
}
