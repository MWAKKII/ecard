-- Card designs are now pure image uploads (spec Step 10 groundwork:
-- "Admin can upload a card template", CardTemplate stores template metadata
-- + the template file). Price and description were never part of a design
-- template and have been removed from the admin UI — drop the columns.
ALTER TABLE "card_templates" DROP COLUMN "description";
ALTER TABLE "card_templates" DROP COLUMN "price";
