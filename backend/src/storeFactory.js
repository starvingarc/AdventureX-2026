import { resolve } from "node:path";

import { PostgresCardStore, createPostgresPool } from "./postgresStore.js";
import { databaseConfigValid } from "./runtimeConfig.js";
import { CardStore } from "./store.js";

export function createCardStore(config, options = {}) {
  if (config.database.configured) {
    if (!databaseConfigValid(config.database)) {
      return new UnavailableStore("database_config_invalid");
    }
    const pool = options.pool || createPostgresPool(config.database);
    return new PostgresCardStore(pool, options);
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
