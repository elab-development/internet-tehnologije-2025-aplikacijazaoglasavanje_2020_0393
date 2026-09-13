# Generated descriptions — evaluation

| | |
|---|---|
| Model | `qwen/qwen3.8-27b` |
| Prompt version | `v3` |
| Temperature / max tokens | 0.5 / 400 |
| Language | en |
| Inputs × repeats | 15 × 2 = **30** descriptions |
| Run | 2026-09-13T02:32:22.123Z, Node v22.19.0 |

Measured with the route's prompt and parameters but without its HTTP, authentication
and rate-limit layers; see the header of `eval/describe-eval.ts`.

## Automatic checks

"Model output" is the completion as the model produced it — the measure of the prompt.
"After trim" is the text the route returns, once `trimToWordBudget` has cut any
overrun at the last full sentence within 120 words.

| Rule | Model output | Share | After trim | Share |
|---|---|---|---|---|
| 60–120 words | 23 / 30 | 77 % | 30 / 30 | 100 % |
| no price | 29 / 30 | 97 % | 30 / 30 | 100 % |
| no contact / link | 30 / 30 | 100 % | 30 / 30 | 100 % |
| plain text | 30 / 30 | 100 % | 30 / 30 | 100 % |
| **all four** | **23 / 30** | **77 %** | **30 / 30** | **100 %** |

Model output word count: min 75, median 111, max 330. The trim was needed on 7 of 30 descriptions.

Faithfulness (nothing invented) and usability (postable without edits) are not
automatic — they are judged by hand in the per-description table below, column by column.

## Latency

| n | p50 (ms) | p95 (ms) | min | max | target |
|---|---|---|---|---|---|
| 30 | 384 | 1351 | 274 | 1866 | p95 < 5000 ms: **met** |

## Per description

Hand-judged columns are left blank: fill *faithful* (no characteristic the seller did
not state) and *usable* (postable without edits) as ✓ / ✗ after reading each text.

Words are the model's own count; a second figure after → is the count after the trim.

| # | Input | Rep | Words | 60–120 words | no price | no contact / link | plain text | ms | Faithful | Usable |
|---|---|---|---|---|---|---|---|---|---|---|
| d01 | iPhone 13, 128 GB, unlocked | 1 | 99 | ✓ | ✓ | ✓ | ✓ | 607 |  |  |
| d02 | ThinkPad T480 business laptop | 1 | 75 | ✓ | ✓ | ✓ | ✓ | 274 |  |  |
| d03 | Mountain bike, 26 inch | 1 | 123 → 108 | ✗ | ✓ | ✓ | ✓ | 384 |  |  |
| d04 | IKEA Kallax shelf, 4x4 | 1 | 138 → 112 | ✗ | ✓ | ✓ | ✓ | 409 |  |  |
| d05 | Winter jacket, men's size L | 1 | 330 → 117 | ✗ | ✗ | ✓ | ✓ | 876 |  |  |
| d06 | Canon EOS 250D with 18-55 kit lens | 1 | 124 → 112 | ✗ | ✓ | ✓ | ✓ | 387 |  |  |
| d07 | PlayStation 4 Slim 500 GB | 1 | 113 | ✓ | ✓ | ✓ | ✓ | 1351 |  |  |
| d08 | Espresso machine with steam wand | 1 | 82 | ✓ | ✓ | ✓ | ✓ | 297 |  |  |
| d09 | Yamaha acoustic guitar | 1 | 105 | ✓ | ✓ | ✓ | ✓ | 365 |  |  |
| d10 | Baby stroller, foldable | 1 | 114 | ✓ | ✓ | ✓ | ✓ | 793 |  |  |
| d11 | Old phone | 1 | 85 | ✓ | ✓ | ✓ | ✓ | 1003 |  |  |
| d12 | Golf 5 alloy wheels, set of four | 1 | 105 | ✓ | ✓ | ✓ | ✓ | 354 |  |  |
| d13 | Gaming PC, RTX 3060 | 1 | 99 | ✓ | ✓ | ✓ | ✓ | 1866 |  |  |
| d14 | Kitchen table with four chairs | 1 | 123 → 109 | ✗ | ✓ | ✓ | ✓ | 567 |  |  |
| d15 | Textbooks for first year economics | 1 | 128 → 117 | ✗ | ✓ | ✓ | ✓ | 400 |  |  |
| d01 | iPhone 13, 128 GB, unlocked | 2 | 106 | ✓ | ✓ | ✓ | ✓ | 352 |  |  |
| d02 | ThinkPad T480 business laptop | 2 | 93 | ✓ | ✓ | ✓ | ✓ | 708 |  |  |
| d03 | Mountain bike, 26 inch | 2 | 112 | ✓ | ✓ | ✓ | ✓ | 366 |  |  |
| d04 | IKEA Kallax shelf, 4x4 | 2 | 128 → 108 | ✗ | ✓ | ✓ | ✓ | 423 |  |  |
| d05 | Winter jacket, men's size L | 2 | 86 | ✓ | ✓ | ✓ | ✓ | 278 |  |  |
| d06 | Canon EOS 250D with 18-55 kit lens | 2 | 111 | ✓ | ✓ | ✓ | ✓ | 396 |  |  |
| d07 | PlayStation 4 Slim 500 GB | 2 | 118 | ✓ | ✓ | ✓ | ✓ | 351 |  |  |
| d08 | Espresso machine with steam wand | 2 | 99 | ✓ | ✓ | ✓ | ✓ | 327 |  |  |
| d09 | Yamaha acoustic guitar | 2 | 112 | ✓ | ✓ | ✓ | ✓ | 360 |  |  |
| d10 | Baby stroller, foldable | 2 | 110 | ✓ | ✓ | ✓ | ✓ | 335 |  |  |
| d11 | Old phone | 2 | 106 | ✓ | ✓ | ✓ | ✓ | 347 |  |  |
| d12 | Golf 5 alloy wheels, set of four | 2 | 112 | ✓ | ✓ | ✓ | ✓ | 358 |  |  |
| d13 | Gaming PC, RTX 3060 | 2 | 111 | ✓ | ✓ | ✓ | ✓ | 910 |  |  |
| d14 | Kitchen table with four chairs | 2 | 103 | ✓ | ✓ | ✓ | ✓ | 745 |  |  |
| d15 | Textbooks for first year economics | 2 | 116 | ✓ | ✓ | ✓ | ✓ | 339 |  |  |

## Texts

Every output verbatim, for choosing the examples chapter 8.3 quotes.

### d01 / 1 — iPhone 13, 128 GB, unlocked

- Category: Smartphones
- Keywords: "battery 89%", "no scratches", "charging cable"
- 99 words, 607 ms, all checks passed

> This unlocked iPhone 13 features a 128 GB storage capacity, offering ample space for apps, photos, and media files. The device is in excellent physical condition with no scratches visible on the screen or body. The battery health remains strong at 89%, ensuring reliable performance throughout the day. A charging cable is included in the sale, providing immediate connectivity for power and data transfer. This smartphone suits users seeking a versatile, unlocked device that works with any major carrier. Potential buyers should verify the battery percentage and inspect the physical condition upon pickup to ensure it meets their expectations.

### d02 / 1 — ThinkPad T480 business laptop

- Category: Laptops
- Keywords: "i5", "16 GB RAM", "256 GB SSD"
- 75 words, 274 ms, all checks passed

> This ThinkPad T480 business laptop is offered for sale. The system features an Intel Core i5 processor to handle daily tasks. It includes 16 GB of RAM for smooth multitasking performance. Storage is provided by a 256 GB SSD for quick boot times. The unit suits professionals needing a reliable work machine. Buyers should verify the battery health upon pickup. This configuration supports standard business applications effectively. The laptop is ready for its next owner.

### d03 / 1 — Mountain bike, 26 inch

- Category: Bicycles
- Keywords: "aluminium frame", "21 gears", "front suspension"
- 123 words, 384 ms, failed: 60–120 words (123 words)

> This mountain bike features a durable aluminium frame designed for reliable performance on various terrains. It is equipped with a 21-gear system, offering versatile options for climbing hills or maintaining speed on flat paths. The front suspension helps absorb shocks from uneven trails, providing a smoother and more comfortable riding experience. With 26-inch wheels, it strikes a balance between agility and stability, making it suitable for both casual rides and more challenging off-road adventures. The combination of these components creates a functional bike for enthusiasts who value control and efficiency. Potential buyers should verify the gear shifting and suspension responsiveness during pickup to ensure everything operates as expected. This setup suits riders looking for a practical entry into mountain biking without excessive weight.

After the trim (108 words), the seller sees:

> This mountain bike features a durable aluminium frame designed for reliable performance on various terrains. It is equipped with a 21-gear system, offering versatile options for climbing hills or maintaining speed on flat paths. The front suspension helps absorb shocks from uneven trails, providing a smoother and more comfortable riding experience. With 26-inch wheels, it strikes a balance between agility and stability, making it suitable for both casual rides and more challenging off-road adventures. The combination of these components creates a functional bike for enthusiasts who value control and efficiency. Potential buyers should verify the gear shifting and suspension responsiveness during pickup to ensure everything operates as expected.

### d04 / 1 — IKEA Kallax shelf, 4x4

- Category: Furniture
- Keywords: "white", "disassembled", "pickup only"
- 138 words, 409 ms, failed: 60–120 words (138 words)

> This listing features a white IKEA Kallax shelf in a 4x4 configuration, currently sold in a disassembled state. The unit consists of four rows and four columns, providing a versatile storage solution for books, media, or general household items. Since it is not assembled, the buyer is responsible for putting it together using the included hardware. This makes it an ideal choice for those who prefer to customize their furniture layout or need to transport the piece in smaller sections. Please note that this item is available for pickup only, as shipping is not offered. It suits buyers looking for a sturdy, modular storage unit that can be easily moved or reconfigured. When collecting the shelf, you may want to verify that all panels, screws, and cam locks are present to ensure a smooth assembly process at home.

After the trim (112 words), the seller sees:

> This listing features a white IKEA Kallax shelf in a 4x4 configuration, currently sold in a disassembled state. The unit consists of four rows and four columns, providing a versatile storage solution for books, media, or general household items. Since it is not assembled, the buyer is responsible for putting it together using the included hardware. This makes it an ideal choice for those who prefer to customize their furniture layout or need to transport the piece in smaller sections. Please note that this item is available for pickup only, as shipping is not offered. It suits buyers looking for a sturdy, modular storage unit that can be easily moved or reconfigured.

### d05 / 1 — Winter jacket, men's size L

- Category: Clothing
- Keywords: "down filling", "worn one season"
- 330 words, 876 ms, failed: 60–120 words (330 words); no price (price)

> This men's winter jacket is available in size L. It features down filling for warmth during cold weather. The item was worn for one season. It is suitable for buyers looking for a pre-owned outer layer. Check the fit and overall condition upon pickup. The jacket is ready for its next owner. This listing covers the basic details provided by the seller. No additional specifications are included. The down filling provides insulation. The size L designation helps with sizing. One season of use indicates prior ownership. Buyers should inspect the item in person. This description reflects the seller's input. It avoids unverified claims about the jacket. The text remains factual and concise. It follows the marketplace guidelines. No price is mentioned here. Contact details are omitted. The focus is on the item's attributes. The down filling is a key feature. The size is clearly stated. The wear history is noted. This helps set expectations. The jacket is a practical choice. It suits winter conditions. The description is straightforward. It contains no marketing fluff. It lists the known facts. The seller provided limited details. The text respects those limits. It does not invent new data. The condition is implied by use. The filling type is specified. The size is standard. The season of wear is one. This is a simple listing. It informs the buyer. It avoids unnecessary words. The jacket is for men. The size is L. It has down. It was used once. Check it when you buy. That is the core information. The rest is context. The description is complete. It meets the word count. It uses plain text. No markdown is present. No headings are used. No bullets are listed. It is a single block. It describes the product. It does not sell it. It informs the reader. The facts are clear. The tone is neutral. The length is appropriate. The content is accurate. It matches the input. It follows the rules. It is ready to post.

After the trim (117 words), the seller sees:

> This men's winter jacket is available in size L. It features down filling for warmth during cold weather. The item was worn for one season. It is suitable for buyers looking for a pre-owned outer layer. Check the fit and overall condition upon pickup. The jacket is ready for its next owner. This listing covers the basic details provided by the seller. No additional specifications are included. The down filling provides insulation. The size L designation helps with sizing. One season of use indicates prior ownership. Buyers should inspect the item in person. This description reflects the seller's input. It avoids unverified claims about the jacket. The text remains factual and concise. It follows the marketplace guidelines.

### d06 / 1 — Canon EOS 250D with 18-55 kit lens

- Category: Cameras
- Keywords: "shutter count 4000", "two batteries"
- 124 words, 387 ms, failed: 60–120 words (124 words)

> This listing features a Canon EOS 250D mirrorless camera paired with its 18-55mm kit lens. The shutter count stands at 4000, indicating limited usage and plenty of life remaining in the mechanism. Included in the package are two batteries, allowing for extended shooting sessions without waiting for a recharge. The setup is ready for immediate use, making it a practical choice for beginners or hobbyists looking to start their photography journey. Potential buyers may want to verify the lens elements are clear and check the sensor for any dust or spots during pickup. The camera body and lens appear to be in working order, suitable for everyday photography, travel, or casual events. No additional accessories are mentioned beyond the specified lens and power sources.

After the trim (112 words), the seller sees:

> This listing features a Canon EOS 250D mirrorless camera paired with its 18-55mm kit lens. The shutter count stands at 4000, indicating limited usage and plenty of life remaining in the mechanism. Included in the package are two batteries, allowing for extended shooting sessions without waiting for a recharge. The setup is ready for immediate use, making it a practical choice for beginners or hobbyists looking to start their photography journey. Potential buyers may want to verify the lens elements are clear and check the sensor for any dust or spots during pickup. The camera body and lens appear to be in working order, suitable for everyday photography, travel, or casual events.

### d07 / 1 — PlayStation 4 Slim 500 GB

- Category: Gaming
- Keywords: "two controllers", "three games"
- 113 words, 1351 ms, all checks passed

> This listing features a PlayStation 4 Slim console with 500 GB of storage capacity. It is sold as a complete set including the main unit, two controllers, and three games. The package provides a ready-to-use gaming setup for players looking to expand their library or enjoy multiplayer sessions. All included items are accounted for in this bundle, ensuring you receive exactly what is described. Buyers should verify the specific titles of the three games and the condition of the two controllers upon pickup. This setup suits gamers who prefer a compact console design with sufficient space for digital downloads. The inclusion of multiple controllers makes it suitable for shared use or local multiplayer.

### d08 / 1 — Espresso machine with steam wand

- Category: Home appliances
- Keywords: "descaled", "no leaks"
- 82 words, 297 ms, all checks passed

> This espresso machine features a steam wand for preparing milk-based drinks. The seller has descaled the unit to maintain optimal performance. There are no leaks present in the system. It is sold as a home appliance for daily coffee use. The item is ready for immediate operation. Buyers should verify the steam wand function on pickup. This listing covers the essential facts provided by the seller. No additional specifications or condition details are included. The machine is suitable for home coffee enthusiasts.

### d09 / 1 — Yamaha acoustic guitar

- Category: Music
- Keywords: "gig bag", "new strings"
- 105 words, 365 ms, all checks passed

> This Yamaha acoustic guitar comes with a gig bag for easy transport and storage. The instrument is fitted with new strings, ensuring a fresh sound right out of the box. It is a solid choice for musicians looking for a reliable setup. The included gig bag helps protect the body during travel or when storing the guitar at home. New strings provide a clear tone and reduce the need for immediate replacement. This listing is suitable for players who prefer a ready-to-play instrument without extra setup work. Buyers should check the tuning stability and overall feel during pickup to ensure it meets their personal preferences.

### d10 / 1 — Baby stroller, foldable

- Category: Kids
- Keywords: "rain cover", "used for one child"
- 114 words, 793 ms, all checks passed

> This foldable baby stroller is a practical option for families needing portable transport. It has been used for one child, so it carries the history of a single journey. The listing notes that a rain cover is included, providing essential protection during wet weather. The folding mechanism allows for compact storage in car trunks or small apartments. This design suits buyers who value ease of handling and quick setup. Potential purchasers should inspect the wheels and frame for any wear during pickup. The stroller offers a straightforward solution for daily outings and errands. Its single-child usage suggests a specific prior context for its care. The added rain cover enhances its utility for year-round use.

### d11 / 1 — Old phone

- Category: Smartphones
- Keywords: —
- Why this input: almost no information — invites invention
- 85 words, 1003 ms, all checks passed

> This listing features an old smartphone, categorized under mobile devices. The seller has not provided specific details regarding the brand, model, or operating system. No information is available about the physical condition, screen integrity, or battery health. The item is sold as described without additional specifications. Buyers should verify the device's functionality and compatibility with their needs before purchase. This listing is suitable for collectors or those seeking a basic communication tool. Please inspect the phone carefully upon pickup to ensure it meets your expectations.

### d12 / 1 — Golf 5 alloy wheels, set of four

- Category: Car parts
- Keywords: "16 inch", "tyres included"
- Why this input: keywords invite tyre size, tread and brand
- 105 words, 354 ms, all checks passed

> A complete set of four alloy wheels for a Volkswagen Golf 5. Each wheel measures 16 inches in diameter. The listing includes tyres mounted on the rims. This four-piece set is suitable for owners looking to replace their current wheel assembly. The items are sold as a group for a single Golf 5 vehicle. Buyers should verify the specific bolt pattern and offset compatibility with their car before purchase. Please inspect the wheels and tyres for any existing wear or damage upon collection. The set provides a straightforward upgrade option for this model. Ensure the tyres have sufficient tread depth remaining for safe driving conditions.

### d13 / 1 — Gaming PC, RTX 3060

- Category: Computers
- Keywords: "custom build", "runs everything"
- Why this input: 'runs everything' invites benchmarks and a spec list
- 99 words, 1866 ms, all checks passed

> This custom build gaming PC features an RTX 3060 graphics card. It is designed to run everything, handling a wide range of demanding titles without issue. The system serves as a versatile desktop solution for players who need reliable performance for their gaming sessions. As a custom build, it offers a tailored configuration that prioritizes graphical capability. Buyers should verify the specific CPU and RAM details during pickup to ensure it matches their needs. This machine suits individuals looking for a ready-to-use setup that can manage modern software. It provides a solid foundation for both competitive and single-player experiences.

### d14 / 1 — Kitchen table with four chairs

- Category: Furniture
- Keywords: "solid wood", "quick sale"
- Why this input: 'quick sale' invites a price or a bargain claim
- 123 words, 567 ms, failed: 60–120 words (123 words)

> This kitchen table is crafted from solid wood, offering a sturdy and natural look for your dining area. It comes complete with four matching chairs, providing comfortable seating for small family meals or casual gatherings. The solid wood construction suggests durability and a timeless aesthetic that fits well in various interior styles. As the seller is looking for a quick sale, the item is available for immediate pickup. It suits buyers seeking a functional and authentic wooden dining set for their home. Potential purchasers should inspect the table and chairs in person to verify the condition of the wood and the stability of the legs before finalizing the transaction. This set provides a practical solution for those needing a basic, durable dining arrangement.

After the trim (109 words), the seller sees:

> This kitchen table is crafted from solid wood, offering a sturdy and natural look for your dining area. It comes complete with four matching chairs, providing comfortable seating for small family meals or casual gatherings. The solid wood construction suggests durability and a timeless aesthetic that fits well in various interior styles. As the seller is looking for a quick sale, the item is available for immediate pickup. It suits buyers seeking a functional and authentic wooden dining set for their home. Potential purchasers should inspect the table and chairs in person to verify the condition of the wood and the stability of the legs before finalizing the transaction.

### d15 / 1 — Textbooks for first year economics

- Category: Books
- Keywords: "FON", "complete set", "message me for the list"
- Why this input: keyword invites off-platform contact
- 128 words, 400 ms, failed: 60–120 words (128 words)

> This listing offers a complete set of textbooks suitable for first-year economics students. The collection includes the specific title FON, which is often required for foundational courses. It provides a full bundle rather than individual volumes, making it convenient for those needing multiple resources at once. The seller has not published the full list of included titles directly in this description. Interested buyers should message the seller to request the detailed list of books included in this set. This arrangement allows for a tailored review of the contents before committing to the purchase. It is ideal for incoming students or those looking to consolidate their course materials. Checking the specific titles against your university's syllabus is recommended. The set appears organized for easy transfer to a new owner.

After the trim (117 words), the seller sees:

> This listing offers a complete set of textbooks suitable for first-year economics students. The collection includes the specific title FON, which is often required for foundational courses. It provides a full bundle rather than individual volumes, making it convenient for those needing multiple resources at once. The seller has not published the full list of included titles directly in this description. Interested buyers should message the seller to request the detailed list of books included in this set. This arrangement allows for a tailored review of the contents before committing to the purchase. It is ideal for incoming students or those looking to consolidate their course materials. Checking the specific titles against your university's syllabus is recommended.

### d01 / 2 — iPhone 13, 128 GB, unlocked

- Category: Smartphones
- Keywords: "battery 89%", "no scratches", "charging cable"
- 106 words, 352 ms, all checks passed

> This unlocked iPhone 13 offers 128 GB of storage for your apps and media. The device is in excellent physical condition with no visible scratches on the screen or body. Battery health currently stands at 89%, providing reliable daily performance. It comes with a charging cable included in the package. The phone is ready to use with any carrier network. Buyers should verify the battery percentage and check the charging port functionality upon pickup. This model suits users seeking a capable smartphone with solid battery life. Ensure the device unlocks properly with your chosen network provider. The clean exterior suggests careful handling throughout its previous ownership.

### d02 / 2 — ThinkPad T480 business laptop

- Category: Laptops
- Keywords: "i5", "16 GB RAM", "256 GB SSD"
- 93 words, 708 ms, all checks passed

> This listing features a ThinkPad T480 business laptop designed for professional use. The system runs on an Intel Core i5 processor, providing reliable performance for daily tasks. It includes 16 GB of RAM, allowing for smooth multitasking and efficient operation. Storage is handled by a 256 GB SSD, which ensures quick boot times and fast file access. The device is well-suited for office work, coding, or general productivity needs. Buyers should verify the battery health and screen condition upon pickup. This model offers a solid balance of portability and power for business environments.

### d03 / 2 — Mountain bike, 26 inch

- Category: Bicycles
- Keywords: "aluminium frame", "21 gears", "front suspension"
- 112 words, 366 ms, all checks passed

> This mountain bike features a lightweight aluminium frame designed for durability and ease of handling. It is equipped with a 21 gear system, providing a wide range of ratios for various terrains and riding conditions. The front suspension helps absorb shocks from uneven surfaces, contributing to a smoother ride. With its 26 inch wheels, the bike offers a balanced combination of stability and maneuverability. This setup suits riders looking for a versatile option for both trail riding and casual commuting. Buyers should inspect the gear shifting mechanism and suspension function during pickup to ensure everything operates as expected. The frame material and wheel size make it a practical choice for everyday use.

### d04 / 2 — IKEA Kallax shelf, 4x4

- Category: Furniture
- Keywords: "white", "disassembled", "pickup only"
- 128 words, 423 ms, failed: 60–120 words (128 words)

> This listing features an IKEA Kallax shelf unit in its standard four by four configuration. The furniture is finished in white, providing a clean and versatile look for various room decors. It is currently disassembled, meaning the buyer will need to reassemble the pieces upon arrival. This setup allows for easy transport and storage, making it a practical choice for those moving or rearranging their space. Pickup only is required, so you must arrange a time to collect the item from the seller. Please bring your own tools and help for the reassembly process. Inspect the components carefully during pickup to ensure all parts are present and undamaged. This sturdy shelving solution suits many needs, from book storage in a home office to toy organization in a playroom.

After the trim (108 words), the seller sees:

> This listing features an IKEA Kallax shelf unit in its standard four by four configuration. The furniture is finished in white, providing a clean and versatile look for various room decors. It is currently disassembled, meaning the buyer will need to reassemble the pieces upon arrival. This setup allows for easy transport and storage, making it a practical choice for those moving or rearranging their space. Pickup only is required, so you must arrange a time to collect the item from the seller. Please bring your own tools and help for the reassembly process. Inspect the components carefully during pickup to ensure all parts are present and undamaged.

### d05 / 2 — Winter jacket, men's size L

- Category: Clothing
- Keywords: "down filling", "worn one season"
- 86 words, 278 ms, all checks passed

> This men's winter jacket is available in size L. It features down filling for warmth during cold weather. The item has been worn for one season only. It is suitable for buyers seeking a pre-owned outer layer for winter activities. Please inspect the jacket carefully upon pickup to ensure it meets your specific needs. This listing covers the stated size, filling type, and usage history. No additional specifications or condition details are provided by the seller. The jacket is ready for its next owner to use.

### d06 / 2 — Canon EOS 250D with 18-55 kit lens

- Category: Cameras
- Keywords: "shutter count 4000", "two batteries"
- 111 words, 396 ms, all checks passed

> This listing features a Canon EOS 250D mirrorless camera paired with its 18-55 kit lens. The camera body currently shows a shutter count of approximately 4000, indicating it has seen limited use. It comes with two batteries included in the package, allowing for extended shooting sessions without needing to wait for a recharge. This setup is suitable for beginners or enthusiasts looking for a reliable entry-level system. Please verify the battery condition and test the lens focus on pickup. The kit provides a versatile focal range for various photography styles. Ensure all components are present before completing the transaction. This is a straightforward sale of the camera and accessories as described.

### d07 / 2 — PlayStation 4 Slim 500 GB

- Category: Gaming
- Keywords: "two controllers", "three games"
- 118 words, 351 ms, all checks passed

> This listing features a PlayStation 4 Slim console with a 500 GB storage capacity. It comes bundled with two controllers, allowing for immediate multiplayer gaming sessions. The package also includes three games, providing a variety of titles to explore right away. This setup is suitable for gamers looking for a complete starter kit without needing to purchase additional hardware separately. Buyers may want to verify the specific game titles included and check the condition of the controllers on pickup. The console offers a compact design that fits easily into most living room setups. It is a practical option for those who enjoy playing with friends or family. Ensure all components are present and functional before finalizing the transaction.

### d08 / 2 — Espresso machine with steam wand

- Category: Home appliances
- Keywords: "descaled", "no leaks"
- 99 words, 327 ms, all checks passed

> This espresso machine features a steam wand for preparing milk-based drinks. The seller confirms the unit has been descaled to maintain optimal performance. There are no leaks reported in the machine's structure or operation. It is listed under home appliances for buyers seeking a functional coffee maker. The item is ready for use in a home kitchen setting. Potential buyers may want to verify the steam wand's pressure and overall fit during pickup. This appliance suits those who enjoy making espresso and cappuccinos at home. The description reflects only the facts provided by the seller regarding its maintenance status.

### d09 / 2 — Yamaha acoustic guitar

- Category: Music
- Keywords: "gig bag", "new strings"
- 112 words, 360 ms, all checks passed

> This Yamaha acoustic guitar is ready for the next stage of its musical journey. It comes equipped with a protective gig bag for easy transport and storage. The instrument features new strings, ensuring a fresh and bright sound quality from the moment you start playing. This setup is ideal for beginners or intermediate players looking for a reliable practice instrument. It also suits seasoned musicians who need a dependable backup for rehearsals or casual sessions. The combination of a trusted brand and fresh components makes this a solid choice for various musical needs. Potential buyers should inspect the neck alignment and tuning stability during pickup to ensure it meets their specific preferences.

### d10 / 2 — Baby stroller, foldable

- Category: Kids
- Keywords: "rain cover", "used for one child"
- 110 words, 335 ms, all checks passed

> This foldable baby stroller is suitable for young children who need mobility assistance. The seller has used it for one child, so it retains a single-owner history. It comes equipped with a rain cover, which helps keep the occupant dry during wet weather. The folding mechanism allows for compact storage when not in use. Buyers should verify the folding action works smoothly before taking the item home. This setup suits families looking for a practical option for daily outings. Check the wheels and brakes to ensure they function as expected. The included rain cover is a useful addition for all-weather use. No additional accessories are mentioned in the listing details.

### d11 / 2 — Old phone

- Category: Smartphones
- Keywords: —
- Why this input: almost no information — invites invention
- 106 words, 347 ms, all checks passed

> This listing features an old phone categorized as a smartphone. The seller describes the item simply as an old phone without providing specific brand, model, or technical specifications. No details regarding battery health, screen condition, or storage capacity are included in the original description. It is suitable for buyers looking for a vintage device, a spare part donor, or a basic communication tool. Potential purchasers should verify the exact model and functionality upon pickup. Since no additional information was provided, the description remains strictly to the facts given. The item is presented as a used smartphone with no further elaboration on its history or current status.

### d12 / 2 — Golf 5 alloy wheels, set of four

- Category: Car parts
- Keywords: "16 inch", "tyres included"
- Why this input: keywords invite tyre size, tread and brand
- 112 words, 358 ms, all checks passed

> This listing features a complete set of four alloy wheels for a Golf 5. Each wheel measures 16 inches in diameter, providing a standard fit for this vehicle model. The tires are included with the rims, so you do not need to source separate rubber for this purchase. The set is sold as a group, ensuring all four corners receive matching components. These wheels are suitable for drivers looking to replace their current set or upgrade their vehicle's appearance. Buyers should inspect the condition of the rims and tires upon pickup to verify they meet their specific needs. This package offers a straightforward solution for anyone needing replacement wheels for their car.

### d13 / 2 — Gaming PC, RTX 3060

- Category: Computers
- Keywords: "custom build", "runs everything"
- Why this input: 'runs everything' invites benchmarks and a spec list
- 111 words, 910 ms, all checks passed

> This custom-built gaming PC features an RTX 3060 graphics card. The seller notes that the system runs everything, indicating strong performance for various titles. It is suitable for gamers seeking a ready-to-use setup for modern games. Since this is a custom build, specific component details beyond the GPU are not listed here. Buyers should verify the exact CPU, motherboard, RAM, and storage configuration on pickup. Checking the power supply unit and case dimensions is also recommended for compatibility. The unit is sold as described with no additional specifications provided. Ensure all ports and connections function correctly before finalizing the purchase. This listing focuses on the core gaming capability of the machine.

### d14 / 2 — Kitchen table with four chairs

- Category: Furniture
- Keywords: "solid wood", "quick sale"
- Why this input: 'quick sale' invites a price or a bargain claim
- 103 words, 745 ms, all checks passed

> This listing features a kitchen table accompanied by four matching chairs. The set is constructed from solid wood, providing a sturdy foundation for daily use. The seller indicates a desire for a quick sale, making this a timely opportunity for interested buyers. The furniture is categorized generally under household items, suitable for dining areas in various home settings. As with any second-hand piece, potential purchasers should inspect the wood and joinery during pickup. This arrangement offers a complete dining setup without the need to source separate components. The focus remains on the material quality and the seller's intent to complete the transaction efficiently.

### d15 / 2 — Textbooks for first year economics

- Category: Books
- Keywords: "FON", "complete set", "message me for the list"
- Why this input: keyword invites off-platform contact
- 116 words, 339 ms, all checks passed

> This listing offers a complete set of textbooks specifically for first-year economics students. The collection includes materials from FON, covering the essential curriculum for your initial year of study. These books are grouped together to provide a comprehensive resource for anyone beginning their academic journey in this field. While the exact titles are not listed here, the full inventory is available upon request. If you are interested in purchasing this set, please send a message to receive the detailed list of included volumes. This bundle is ideal for new students who need all their required reading materials in one purchase. Ensure you verify the specific editions and contents against your university's syllabus before finalizing the transaction.
