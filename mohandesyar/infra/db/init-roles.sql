-- Cluster-level setup, run once by a superuser before the first migration (docs/04 §3).
-- Passwords come from psql variables: psql -v owner_pw=... -v app_pw=... -f init-roles.sql
\set ON_ERROR_STOP on
SELECT format('CREATE ROLE mohandesyar_owner LOGIN PASSWORD %L', :'owner_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mohandesyar_owner') \gexec
SELECT format('CREATE ROLE mohandesyar_app LOGIN NOBYPASSRLS PASSWORD %L', :'app_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mohandesyar_app') \gexec
-- Owns the few SECURITY DEFINER helpers that must read across tenants (login membership lookup,
-- outbox claiming, usage counters, audit chain). It cannot log in.
SELECT 'CREATE ROLE mohandesyar_definer NOLOGIN BYPASSRLS'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mohandesyar_definer') \gexec
GRANT mohandesyar_definer TO mohandesyar_owner;
ALTER ROLE mohandesyar_app NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE mohandesyar_owner NOSUPERUSER NOBYPASSRLS;
SELECT format('CREATE DATABASE %I OWNER mohandesyar_owner', :'db_name')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec
\connect :db_name
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO mohandesyar_owner;
GRANT USAGE ON SCHEMA public TO mohandesyar_app, mohandesyar_definer;
GRANT CREATE ON SCHEMA public TO mohandesyar_definer; -- needed to own functions; the role cannot log in
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;
