import { readdirSync, readFileSync } from 'fs';
const path = require("path").join("database");
const { Client } = require('pg');
require('dotenv').config();


const conn = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});
conn.connect();

const colors = {
    red: '\x1b[31m%s\x1b[0m',
    green: '\x1b[32m%s\x1b[0m',
    yellow: '\x1b[33m%s\x1b[0m',
    blue: '\x1b[34m%s\x1b[0m',
    magenta: '\x1b[35m%s\x1b[0m',
    cyan: '\x1b[36m%s\x1b[0m'
};

class Migration {

    public id: number;
    public name: string;
    public batch: number;

    constructor(data: any) {
        this.id = data.id;
        this.name = data.name;
        this.batch = data.batch;
    }
}

export const migrate = async () => {

    await new Promise((resolve, reject) => {
        conn.query('CREATE TABLE IF NOT EXISTS migrations (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, batch INT NOT NULL)', (err: any, _rows: any) => {
            if (err) {
                conn.end();
                return reject(err);
            };
            return resolve(0);
        });
    });

    let migrated: Migration[] = await new Promise((resolve, reject) => {
        conn.query('SELECT name, batch FROM migrations', (err: Error, result: any) => {
            if (err) {
                conn.end();
                return reject(err);
            };
            return resolve(result.rows);
        });
    });

    let batch = 0;

    if (migrated.length > 0) {
        batch = migrated.reduce((a: Migration, b: Migration) => a.batch > b.batch ? a : b).batch;
    };

    batch++;
    console.log(colors.magenta, `Migrating batch number ${batch}`);

    let all_migrations = readdirSync(path + "/migrations");

    let len = all_migrations.length;
    for (let i = 0; i < len; i++) {

        let migration_name = all_migrations[i];

        if (migrated.some(element => element.name === migration_name)) {
            console.log(colors.yellow, migration_name + " already migrated");
            continue;
        }

        const sql = readFileSync(`${path}/migrations/${migration_name}/up.sql`, 'utf8');
        console.log(colors.cyan, "Migrating " + migration_name);

        await new Promise((resolve, reject) => {
            conn.query(sql, (err: any, _result: any) => {
                if (err) {
                    console.log(err);
                    conn.end();
                    i = len;
                    return reject(err);
                };
                console.log(colors.green, 'Completed');
                conn.query('INSERT INTO migrations (name, batch) VALUES ($1,$2)', [migration_name, batch]);
                return resolve(0);
            });
        });
    };
    console.log(colors.blue, 'Finished migrating');

    conn.end();
    process.exit();
}


export const rollback = async (refresh = false) => {

    let migrated: Migration[] = await new Promise((resolve, reject) => {
        conn.query('SELECT name, batch FROM migrations', (err: any, results: any) => {
            if (err) {
                return reject(err);
            };
            return resolve(results.rows);
        });
    });

    if (!migrated || migrated.length == 0) {
        console.log(colors.yellow, 'No migrations to revert');
        if (refresh) return 0;
        process.exit();
    };

    let batch = migrated.reduce((a, b) => a.batch > b.batch ? a : b).batch;
    console.log(colors.magenta, 'Reverting batch number ' + batch);

    let rolling_migrations = migrated.filter(element => element.batch == batch).sort((a, b) => b.id - a.id);
    let len = rolling_migrations.length;

    for (let i = 0; i < len; i++) {

        let migration_name = rolling_migrations[i].name;

        const sql = readFileSync(`${path}/migrations/${migration_name}/down.sql`, 'utf8');
        console.log(colors.cyan, "Rolling back " + migration_name);

        await new Promise((resolve, reject) => {
            conn.query(sql, (err: any, _result: any) => {
                if (err) {
                    console.log(err);
                    conn.end();
                    i = len;
                    return reject(err);
                };
                console.log(colors.green, 'Completed');
                conn.query('DELETE FROM migrations WHERE name = ($1)', [migration_name]);
                return resolve(0);
            });
        });
    };
    console.log(colors.blue, 'Finished reverting');

    if (refresh) return batch;

    conn.end();
    process.exit();
};

export const refresh = async () => {

    let reverted_batch = await rollback(true);
    while (reverted_batch > 1) reverted_batch = await rollback(true)
    await migrate();
};

export const seed = async () => {

    let seeders: string[] = ['init'];

    for (let seeder_name of seeders) {

        const sql = readFileSync(`${path}/seeders/${seeder_name}.sql`, 'utf8');
        console.log(colors.cyan, `Seeding ${seeder_name}`);

        const sql_array = sql.split(';');

        for (const sql_part of sql_array) {

            await new Promise((resolve, reject) => {
                conn.query(sql_part, (err: any, _result: any) => {
                    if (err) {
                        console.log(err);
                        conn.end();
                        return reject(err);
                    };
                    return resolve(0);
                });
            });
        }
        console.log(colors.green, 'Completed');
    };

    conn.end();
    process.exit();
};