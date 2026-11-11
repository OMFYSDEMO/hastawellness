-- Where an enquiry came from: instagram | facebook | google | whatsapp | youtube | website (web forms),
-- or phone | walk-in | referral | other (entered by staff in the clinic app).
ALTER TABLE leads ADD COLUMN channel TEXT;
