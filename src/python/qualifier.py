import csv
import os
import re
import sys
import time
from urllib.parse import urlparse

import requests


def clean_business_name(name: str | None) -> str:
    """Return a concise business name suitable for outreach messages."""
    if not name:
        return "Unknown Shop"

    clean_name = str(name)
    delimiters = ["|", "-", "-", "-", ":", ",", "("]
    for delim in delimiters:
        if delim in clean_name:
            clean_name = clean_name.split(delim)[0]

    clean_name = clean_name.strip()
    clean_name = re.sub(r"(?i)\bl\b\.\bl\b\.\bc\b\.?", "", clean_name)
    clean_name = re.sub(r"(?i)\bllc\b", "", clean_name)
    clean_name = re.sub(r"(?i)\binc\.?\b", "", clean_name)
    clean_name = re.sub(r"\s+", " ", clean_name).strip()
    clean_name = re.sub(r"[^a-zA-Z0-9]+$", "", clean_name)

    return clean_name or "Unknown Shop"


def check_website(url: str) -> tuple[str, int, bool, float, str | None]:
    """Check website availability and return normalized URL + health metrics."""
    if not url:
        return "", 0, False, 0.0, "No URL"

    base = re.sub(r"^https?://", "", url.strip(), flags=re.IGNORECASE).strip("/")
    if not base:
        return "", 0, False, 0.0, "No URL"

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; LeadQualifier/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    for scheme in ("https://", "http://"):
        full_url = f"{scheme}{base}"
        try:
            start = time.time()
            response = requests.get(full_url, headers=headers, timeout=8, allow_redirects=True)
            response_time = time.time() - start
            status_code = int(response.status_code)
            final_url = response.url or full_url
            parsed = urlparse(final_url)
            has_ssl = parsed.scheme.lower() == "https"
            error_msg = f"HTTP Error {status_code}" if status_code >= 400 else None
            return final_url, status_code, has_ssl, response_time, error_msg
        except requests.RequestException:
            continue

    return f"https://{base}", 0, False, 0.0, "Connection Failed"


def score_website(
    website: str,
    status_code: int,
    has_ssl: bool,
    response_time: float,
    error_msg: str | None,
) -> tuple[int, str, str]:
    """Compute opportunity score and tag from website signals."""
    if not website:
        return 10, "No website", "HOT"
    if status_code == 0 or (status_code >= 400):
        return 9, error_msg or "Broken website", "HOT"
    if not has_ssl:
        return 7, "HTTP only (No SSL)", "WARM"
    if response_time > 3:
        return 6, f"Slow website ({response_time:.1f}s)", "WARM"
    return 2, "Healthy website", "COLD"


def qualify_leads(input_file: str, output_file: str | None = None) -> str:
    """Read a leads CSV and write a qualified CSV with score/tag columns."""
    if not os.path.exists(input_file):
        raise FileNotFoundError(f"Input CSV not found: {input_file}")

    if not output_file:
        base, ext = os.path.splitext(input_file)
        output_file = f"{base}_qualified{ext or '.csv'}"

    qualified_leads: list[dict[str, str]] = []

    with open(input_file, encoding="utf-8-sig", newline="") as infile:
        reader = csv.DictReader(infile)
        fieldnames = list(reader.fieldnames or [])

        extra_fields = ["Opportunity Score", "Qualification Reason", "Lead Tag"]
        for field in extra_fields:
            if field not in fieldnames:
                fieldnames.append(field)

        for lead in reader:
            website = (lead.get("website") or lead.get("Website") or "").strip()
            final_url, status_code, has_ssl, response_time, error_msg = check_website(website)
            score, reason, tag = score_website(website, status_code, has_ssl, response_time, error_msg)

            lead["Opportunity Score"] = str(score)
            lead["Qualification Reason"] = reason
            lead["Lead Tag"] = tag

            clean_name = clean_business_name(lead.get("business_name") or lead.get("Name") or "")
            if "business_name" in lead:
                lead["business_name"] = clean_name
            elif "Name" in lead:
                lead["Name"] = clean_name

            if final_url and ("website" in lead or "Website" in lead):
                if "website" in lead:
                    lead["website"] = final_url
                if "Website" in lead:
                    lead["Website"] = final_url

            qualified_leads.append(lead)

    with open(output_file, mode="w", encoding="utf-8", newline="") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(qualified_leads)

    return output_file


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python qualifier.py <input_csv> [output_csv]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        written = qualify_leads(input_file, output_file)
        print(f"Qualification complete. Wrote: {written}")
    except FileNotFoundError as err:
        print(f"Error: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
