# Tasks for Webhook Server Improvements

- [x] Task 1: Centralize configuration in `webhook.py`.
  - [x] Consolidate all `os.getenv` calls into a single configuration section at the top of the file.
  - [x] Remove scattered configuration loading.

- [x] Task 2: Implement structured logging in `webhook.py`.
  - [x] Set up the `logging` module with a consistent format.
  - [x] Replace all `print` statements with appropriate `logging.info`, `logging.warning`, or `logging.error` calls.

- [x] Task 3: Refactor CRM functions for better error handling.
  - [x] Add specific `try...except` blocks for `gspread.exceptions.SpreadsheetNotFound` and `gspread.exceptions.CellNotFound`.
  - [x] Log detailed error messages when these exceptions occur.
