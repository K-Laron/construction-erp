import 'better-sqlite3';

declare module 'better-sqlite3' {
  interface Database {
    memory?: boolean;
  }
}
