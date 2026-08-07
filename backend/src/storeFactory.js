import { resolve } from "node:path";

import { PostgresCardStore, createPostgresPool } from "./postgresStore.js";
import { databaseConfigValid } from "./runtimeConfig.js";
import { CardStore } from "./store.js";

export function createCardStore(config, options = {}) {
  if (!config.storage.driverValid) {
    return new UnavailableStore("storage_driver_invalid");
  }
  if (config.storage.driver === "postgres") {
    if (!config.database.configured) {
      return new UnavailableStore("database_url_missing");
    }
    if (!databaseConfigValid(config.database)) {
      return new UnavailableStore("database_config_invalid");
    }
    const pool = options.pool || createPostgresPool(config.database);
    return new PostgresCardStore(pool, options);
  }
  if (config.database.configured) {
    return new UnavailableStore("storage_driver_mismatch");
  }
  return new CardStore(
    config.storage.filePath || resolve(".runtime/cards.json")
  );
}

class UnavailableStore {
  constructor(reason) {
    this.reason = reason;
  }

  async readiness() {
    return {
      ready: false,
      driver: "postgres",
      durable: true,
      reason: this.reason,
      appliedVersions: [],
      pendingVersions: []
    };
  }

  async list() {
    throw unavailableError();
  }

  async get() {
    throw unavailableError();
  }

  async save() {
    throw unavailableError();
  }

  async assess() {
    throw unavailableError();
  }

  async delete() {
    throw unavailableError();
  }

  async close() {}
}

function unavailableError() {
  return Object.assign(new Error("数据库配置无效。"), {
    statusCode: 503,
    code: "database_config_invalid",
    expose: true
  });
}
