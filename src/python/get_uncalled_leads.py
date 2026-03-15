"""
Get Uncalled Leads
==================
This script generates a list of leads that have not yet been successfully called
by the automated outreach agents (e.g., `vapi_call.js`).

It works by:
1. Reading the `logs/call_attempts.jsonl` file to get a list of all phone
   numbers that have been successfully called.
2. Reading a master list of leads from an input CSV file.
3. Comparing the two lists and outputting a new CSV containing only the leads
   whose phone numbers do not appear in the call log.

Usage:
    python src/python/get_uncalled_leads.py <input_csv_path> <output_csv_path>

Example:
    python src/python/get_uncalled_leads.py data/houston-tx_qualified.csv data/uncalled_leads.csv
"""

import os
import json
import csv
import sys
import re

# Path to the log file that contains records of all call attempts.
# This is based on the path in `src/node/vapi_call.js`.
CALL_LOG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "logs", "call_attempts.jsonl"
)

def normalize_phone(phone: str) -> str:
    """
    Normalizes a phone number to E.164 format (e.g., +17135551234).
    Matches the normalization logic in vapi_call.js for US numbers.
    """
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if not digits:
        return ""
    # Handle numbers that already include the country code '1'
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    # Handle 10-digit numbers (assume US)
    if len(digits) == 10:
        return f"+1{digits}"
    # Fallback for other formats, just prepend +
    return f"+{digits}"

def get_called_phones() -> set[str]:
    """
    Reads the call log and returns a set of successfully called phone numbers.
    """
    called_phones = set()
    if not os.path.exists(CALL_LOG_PATH):
        print(f"Info: Call log not found at '{CALL_LOG_PATH}'. Assuming no calls made yet.")
        return called_phones

    with open(CALL_LOG_PATH, "r", encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
                # We only count calls that were successfully initiated ('ok').
                if entry.get("status") == "ok" and entry.get("phone"):
                    normalized = normalize_phone(entry["phone"])
                    if normalized:
                        called_phones.add(normalized)
            except json.JSONDecodeError:
                continue # Ignore malformed lines
    
    print(f"Found {len(called_phones)} unique numbers in the call log.")
    return called_phones

def filter_uncalled_leads(input_csv_path: str, output_csv_path: str):
    """
    Filters a lead CSV to find leads that have not been called yet.
    """
    if not os.path.exists(input_csv_path):
        print(f"Error: Input file not found at '{input_csv_path}'")
        sys.exit(1)

    called_phones = get_called_phones()
    uncalled_leads = []
    
    with open(input_csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        
        for row in reader:
            phone = row.get("phone", row.get("Phone", row.get("telephone", "")))
            normalized_phone = normalize_phone(phone)
            
            if normalized_phone and normalized_phone not in called_phones:
                uncalled_leads.append(row)

    if not uncalled_leads:
        print("No new uncalled leads found.")
        return

    print(f"Found {len(uncalled_leads)} uncalled leads. Saving to '{output_csv_path}'...")
    
    with open(output_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(uncalled_leads)
        
    print(f"Successfully created '{output_csv_path}'.")

def main():
    """
    Main function to run the script from the command line.
    """
    if len(sys.argv) < 3:
        print("Usage: python get_uncalled_leads.py <input_leads.csv> <output_uncalled.csv>")
        print("\nExample: python src/python/get_uncalled_leads.py data/houston-tx/leads_qualified.csv data/uncalled_leads.csv")
        sys.exit(1)
        
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    
    filter_uncalled_leads(input_file, output_file)

if __name__ == "__main__":
    main()