import os
from dotenv import load_dotenv

load_dotenv()

def send_welcome_email(client_email, shop_name, live_url):
    """(Removed) Sends a professional "Welcome Package" email with the link and instructions"""
    print(f"[Email Skip] Email delivery removed. Mocking Email to {client_email}")
    return True

def enroll_in_upsell_drip(client_name, client_email):
    """
    Placeholder for enrolling the user in a 7-day or 14-day email drip.
    In production, you could use an API call to ActiveCampaign, Klaviyo, or Zapier here.
    """
    print(f"  [UPSELL] {client_name} ({client_email}) has been enrolled in the 'Post-Launch SEO Upsell' drip sequence.")


def trigger_delivery_flow(lead_data, live_url):
    """
    Main function to execute Stage 13 & 14.
    """
    print(f"\n[DELIVERY AGENT] Initiating Delivery Protocol for {lead_data.get('business_name')}...")
    
    phone = lead_data.get('phone')
    email = lead_data.get('email', 'N/A')
    shop_name = lead_data.get('business_name', 'Shop Owner')
    
    # 1. Send Email
    if email != 'N/A':
        send_welcome_email(email, shop_name, live_url)
        
    # 2. Queue Upsell Sequence
    enroll_in_upsell_drip(shop_name, email)
    
    print("\n  [*] DELIVERY PROTOCOL COMPLETE. The client has received their product.")


if __name__ == "__main__":
    # Test payload
    test_client = {
        "business_name": "Cloud 9 Smoke Shop",
        "phone": "+17135559999", # Note: Twilio needs E.164 format
        "email": "test@example.com"
    }
    test_url = "https://premiumsmokeshop-cloud-9.vercel.app"
    
    trigger_delivery_flow(test_client, test_url)
