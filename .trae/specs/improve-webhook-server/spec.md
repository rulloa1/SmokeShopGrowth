# Webhook Server Improvements Spec

## Why
The existing webhook server in `src/python/webhook.py` is functional but lacks the robustness and maintainability required for a production-grade application. The configuration is scattered, logging is inconsistent (relying on `print` statements), and error handling is not specific enough, making it difficult to debug and manage.

## What Changes
- **Centralize Configuration:** Consolidate all environment variable loading and configuration into a single, organized section at the top of the file.
- **Implement Structured Logging:** Replace all `print` statements with a proper logging setup (using Python's `logging` module) to provide structured, leveled log messages.
- **Improve Error Handling:** Refactor the CRM functions to catch more specific exceptions (e.g., `gspread.exceptions.SpreadsheetNotFound`) and provide more informative error messages.

## Impact
- **Affected Code:** `src/python/webhook.py`

## ADDED Requirements

### Requirement: Centralized Configuration
The system SHALL load all configuration from environment variables in a single, clearly-defined section at the beginning of the `webhook.py` script.

#### Scenario: Configuration Loading
- **WHEN** the application starts
- **THEN** all required configuration values (Stripe keys, Google Sheet URL, SMTP settings, etc.) are loaded from the environment.

### Requirement: Structured Logging
The system SHALL use the `logging` module for all log output, replacing all `print` statements.

#### Scenario: Webhook Request
- **WHEN** a webhook is received
- **THEN** the application logs the event with an appropriate log level (e.g., INFO, WARNING, ERROR) and a structured message.

## MODIFIED Requirements

### Requirement: CRM Error Handling
The CRM helper functions SHALL catch specific exceptions related to Google Sheets operations and log detailed error messages.

#### Scenario: Google Sheet Not Found
- **WHEN** a CRM function is called and the Google Sheet cannot be found
- **THEN** the application logs an ERROR message indicating that the spreadsheet was not found and gracefully returns `None` or exits the function.
