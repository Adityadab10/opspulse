"""Initialize the versioned saver schema on the verified fresh database."""

from contextlib import closing

from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import connect

from new_database import new_database_connection


def setup():
    load_dotenv()
    dsn, options = new_database_connection()
    with closing(connect(dsn, autocommit=True, options="-c search_path=opspulse_checkpoints", **options)) as connection:
        with connection.transaction():
            database, initialized = connection.execute(
                "SELECT current_database(), to_regclass('public.opspulse_schema_migrations') IS NOT NULL"
            ).fetchone()
            if database != "postgres" or not initialized:
                raise RuntimeError("The fresh OpsPulse schema is required before checkpoint setup")
        PostgresSaver(connection).setup()
        with connection.transaction():
            connection.execute(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA opspulse_checkpoints TO opspulse_checkpointer"
            )


if __name__ == "__main__":
    try:
        setup()
    except Exception as error:
        print(f"Checkpoint setup failed: {getattr(error, 'sqlstate', None) or type(error).__name__}")
        raise SystemExit(1) from None
