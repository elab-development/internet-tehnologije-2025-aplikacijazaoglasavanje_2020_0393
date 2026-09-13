# Generated descriptions — evaluation

| | |
|---|---|
| Model | `qwen/qwen3.8-27b` |
| Prompt version | `v2` |
| Temperature / max tokens | 0.5 / 400 |
| Language | en |
| Inputs × repeats | 15 × 2 = **30** descriptions |
| Run | 2026-09-13T02:26:43.228Z, Node v22.19.0 |

Measured with the route's prompt and parameters but without its HTTP, authentication
and rate-limit layers; see the header of `eval/describe-eval.ts`.

## Automatic checks

"Model output" is the completion as the model produced it — the measure of the prompt.
"After trim" is the text the route returns, once `trimToWordBudget` has cut any
overrun at the last full sentence within 120 words.

| Rule | Model output | Share | After trim | Share |
|---|---|---|---|---|
| 60–120 words | 25 / 30 | 83 % | 25 / 30 | 83 % |
| no price | 29 / 30 | 97 % | 29 / 30 | 97 % |
| no contact / link | 30 / 30 | 100 % | 30 / 30 | 100 % |
| plain text | 30 / 30 | 100 % | 30 / 30 | 100 % |
| **all four** | **24 / 30** | **80 %** | **24 / 30** | **80 %** |

Model output word count: min 42, median 79, max 110. The trim was needed on 0 of 30 descriptions.

Faithfulness (nothing invented) and usability (postable without edits) are not
automatic — they are judged by hand in the per-description table below, column by column.

## Latency

| n | p50 (ms) | p95 (ms) | min | max | target |
|---|---|---|---|---|---|
| 30 | 346 | 2755 | 239 | 4942 | p95 < 5000 ms: **met** |

## Per description

Hand-judged columns are left blank: fill *faithful* (no characteristic the seller did
not state) and *usable* (postable without edits) as ✓ / ✗ after reading each text.

Words are the model's own count; a second figure after → is the count after the trim.

| # | Input | Rep | Words | 60–120 words | no price | no contact / link | plain text | ms | Faithful | Usable |
|---|---|---|---|---|---|---|---|---|---|---|
| d01 | iPhone 13, 128 GB, unlocked | 1 | 58 | ✗ | ✓ | ✓ | ✓ | 717 |  |  |
| d02 | ThinkPad T480 business laptop | 1 | 79 | ✓ | ✓ | ✓ | ✓ | 279 |  |  |
| d03 | Mountain bike, 26 inch | 1 | 86 | ✓ | ✓ | ✓ | ✓ | 283 |  |  |
| d04 | IKEA Kallax shelf, 4x4 | 1 | 77 | ✓ | ✓ | ✓ | ✓ | 4942 |  |  |
| d05 | Winter jacket, men's size L | 1 | 74 | ✓ | ✓ | ✓ | ✓ | 1419 |  |  |
| d06 | Canon EOS 250D with 18-55 kit lens | 1 | 75 | ✓ | ✓ | ✓ | ✓ | 287 |  |  |
| d07 | PlayStation 4 Slim 500 GB | 1 | 95 | ✓ | ✓ | ✓ | ✓ | 325 |  |  |
| d08 | Espresso machine with steam wand | 1 | 42 | ✗ | ✓ | ✓ | ✓ | 556 |  |  |
| d09 | Yamaha acoustic guitar | 1 | 88 | ✓ | ✗ | ✓ | ✓ | 289 |  |  |
| d10 | Baby stroller, foldable | 1 | 93 | ✓ | ✓ | ✓ | ✓ | 316 |  |  |
| d11 | Old phone | 1 | 71 | ✓ | ✓ | ✓ | ✓ | 240 |  |  |
| d12 | Golf 5 alloy wheels, set of four | 1 | 85 | ✓ | ✓ | ✓ | ✓ | 275 |  |  |
| d13 | Gaming PC, RTX 3060 | 1 | 87 | ✓ | ✓ | ✓ | ✓ | 346 |  |  |
| d14 | Kitchen table with four chairs | 1 | 84 | ✓ | ✓ | ✓ | ✓ | 295 |  |  |
| d15 | Textbooks for first year economics | 1 | 82 | ✓ | ✓ | ✓ | ✓ | 438 |  |  |
| d01 | iPhone 13, 128 GB, unlocked | 2 | 52 | ✗ | ✓ | ✓ | ✓ | 239 |  |  |
| d02 | ThinkPad T480 business laptop | 2 | 59 | ✗ | ✓ | ✓ | ✓ | 1223 |  |  |
| d03 | Mountain bike, 26 inch | 2 | 82 | ✓ | ✓ | ✓ | ✓ | 563 |  |  |
| d04 | IKEA Kallax shelf, 4x4 | 2 | 60 | ✓ | ✓ | ✓ | ✓ | 245 |  |  |
| d05 | Winter jacket, men's size L | 2 | 75 | ✓ | ✓ | ✓ | ✓ | 251 |  |  |
| d06 | Canon EOS 250D with 18-55 kit lens | 2 | 82 | ✓ | ✓ | ✓ | ✓ | 492 |  |  |
| d07 | PlayStation 4 Slim 500 GB | 2 | 75 | ✓ | ✓ | ✓ | ✓ | 814 |  |  |
| d08 | Espresso machine with steam wand | 2 | 52 | ✗ | ✓ | ✓ | ✓ | 2731 |  |  |
| d09 | Yamaha acoustic guitar | 2 | 72 | ✓ | ✓ | ✓ | ✓ | 725 |  |  |
| d10 | Baby stroller, foldable | 2 | 71 | ✓ | ✓ | ✓ | ✓ | 761 |  |  |
| d11 | Old phone | 2 | 89 | ✓ | ✓ | ✓ | ✓ | 287 |  |  |
| d12 | Golf 5 alloy wheels, set of four | 2 | 81 | ✓ | ✓ | ✓ | ✓ | 2755 |  |  |
| d13 | Gaming PC, RTX 3060 | 2 | 90 | ✓ | ✓ | ✓ | ✓ | 289 |  |  |
| d14 | Kitchen table with four chairs | 2 | 110 | ✓ | ✓ | ✓ | ✓ | 358 |  |  |
| d15 | Textbooks for first year economics | 2 | 96 | ✓ | ✓ | ✓ | ✓ | 1880 |  |  |

## Texts

Every output verbatim, for choosing the examples chapter 8.3 quotes.

### d01 / 1 — iPhone 13, 128 GB, unlocked

- Category: Smartphones
- Keywords: "battery 89%", "no scratches", "charging cable"
- 58 words, 717 ms, failed: 60–120 words (58 words)

> This unlocked iPhone 13 features 128 GB of storage capacity. The device is in excellent physical condition with no scratches visible on the exterior. The battery health currently stands at 89 percent. A charging cable is included in the sale. The phone is ready for immediate use with any carrier. No additional accessories are listed beyond the cable.

### d02 / 1 — ThinkPad T480 business laptop

- Category: Laptops
- Keywords: "i5", "16 GB RAM", "256 GB SSD"
- 79 words, 279 ms, all checks passed

> This ThinkPad T480 business laptop is available for sale. It features an Intel Core i5 processor to handle daily computing tasks. The system includes 16 GB of RAM, providing ample memory for multitasking and running multiple applications simultaneously. Storage is managed by a 256 GB SSD, which offers fast boot times and quick file access. The device is configured as a standard business machine suitable for office work. All listed specifications reflect the current hardware setup of the unit.

### d03 / 1 — Mountain bike, 26 inch

- Category: Bicycles
- Keywords: "aluminium frame", "21 gears", "front suspension"
- 86 words, 283 ms, all checks passed

> This mountain bike features a 26 inch wheel size suitable for various terrains. The frame is constructed from aluminium, offering a lightweight structure for easier handling. It includes a 21 gear system to provide flexibility across different speeds and inclines. A front suspension fork is installed to absorb shocks from rough surfaces. These components work together to create a functional setup for outdoor riding. The listing focuses on these specific mechanical and structural elements. No additional accessories or condition details are provided in the original information.

### d04 / 1 — IKEA Kallax shelf, 4x4

- Category: Furniture
- Keywords: "white", "disassembled", "pickup only"
- 77 words, 4942 ms, all checks passed

> This listing features a white IKEA Kallax shelf unit configured in a four by four grid. The item is currently disassembled and ready for transport. Pickup only is required as the seller will not ship this furniture piece. The structure provides ample storage space for books, media, or decorative items. All components are included for reassembly at the new location. The white finish remains consistent with the original design. Buyers should arrange their own vehicle for removal.

### d05 / 1 — Winter jacket, men's size L

- Category: Clothing
- Keywords: "down filling", "worn one season"
- 74 words, 1419 ms, all checks passed

> This men's winter jacket is available in size L. It features down filling for insulation during cold weather. The item has been worn for one season. The seller provides these specific details regarding the garment's size, filling material, and usage history. No additional condition notes or specifications are included in the listing. The jacket is listed under the clothing category. Buyers can review the provided facts to determine if the item fits their needs.

### d06 / 1 — Canon EOS 250D with 18-55 kit lens

- Category: Cameras
- Keywords: "shutter count 4000", "two batteries"
- 75 words, 287 ms, all checks passed

> This listing features a Canon EOS 250D mirrorless camera paired with the standard 18-55 kit lens. The shutter count is currently at 4,000 actuations, indicating relatively light usage. The package includes two batteries to support extended shooting sessions. The camera and lens are presented as a complete set for photography enthusiasts. No other accessories or condition details are specified in the seller's notes. This setup offers a versatile option for both beginners and experienced users.

### d07 / 1 — PlayStation 4 Slim 500 GB

- Category: Gaming
- Keywords: "two controllers", "three games"
- 95 words, 325 ms, all checks passed

> This listing features a PlayStation 4 Slim console with 500 GB of internal storage. The seller includes two controllers to allow for immediate multiplayer gaming sessions. Three games are also part of the package, providing a ready-to-play setup for various genres. The console is offered as a complete bundle for those looking to expand their gaming library. All items are listed together in this single transaction. The seller has provided these specific details regarding the hardware and included accessories. No additional information about the condition or specific game titles is available in the provided data.

### d08 / 1 — Espresso machine with steam wand

- Category: Home appliances
- Keywords: "descaled", "no leaks"
- 42 words, 556 ms, failed: 60–120 words (42 words)

> The espresso machine features a steam wand for frothing milk. It has been descaled to maintain optimal performance. There are no leaks in the unit. The appliance is ready for use in your home. It is a functional piece of kitchen equipment.

### d09 / 1 — Yamaha acoustic guitar

- Category: Music
- Keywords: "gig bag", "new strings"
- 88 words, 289 ms, failed: no price (costs)

> This listing features a Yamaha acoustic guitar, a reliable choice for musicians of various skill levels. The instrument comes with a dedicated gig bag, providing necessary protection during transport and storage. The strings have been replaced with new ones, ensuring a fresh and clear tone right out of the box. This setup is ideal for players who want to start playing immediately without additional setup costs. The guitar is ready for practice sessions, rehearsals, or casual jamming. All items described are included in the sale as detailed above.

### d10 / 1 — Baby stroller, foldable

- Category: Kids
- Keywords: "rain cover", "used for one child"
- 93 words, 316 ms, all checks passed

> This baby stroller is designed to fold easily for convenient storage and transport. It includes a rain cover to keep your child dry during wet weather. The stroller has been used for one child, so it shows signs of normal wear consistent with its history. All moving parts function as intended, allowing for smooth navigation on various surfaces. The frame remains sturdy, providing a stable base for daily use. This item offers a practical solution for parents needing a reliable piece of gear. The included rain cover adds versatility for different seasonal conditions.

### d11 / 1 — Old phone

- Category: Smartphones
- Keywords: —
- Why this input: almost no information — invites invention
- 71 words, 240 ms, all checks passed

> The seller lists an old phone under the smartphones category. The item is described simply as an old phone without further specification. No brand, model, or condition details are provided in the listing. The description remains limited to the basic identification of the device. There are no additional features or specifications mentioned by the seller. The listing focuses solely on the general nature of the item as an older mobile phone.

### d12 / 1 — Golf 5 alloy wheels, set of four

- Category: Car parts
- Keywords: "16 inch", "tyres included"
- Why this input: keywords invite tyre size, tread and brand
- 85 words, 275 ms, all checks passed

> This listing features a complete set of four alloy wheels designed for the Volkswagen Golf 5. The wheels measure 16 inches in diameter, providing a standard fitment option for this model. Each wheel comes with a tyre already mounted, ensuring the set is ready for immediate installation. The seller includes all four units, creating a full matching set for the vehicle. These components are sold as a group rather than individually. The listing focuses on the wheel and tyre combination for the specified car model.

### d13 / 1 — Gaming PC, RTX 3060

- Category: Computers
- Keywords: "custom build", "runs everything"
- Why this input: 'runs everything' invites benchmarks and a spec list
- 87 words, 346 ms, all checks passed

> This custom-built gaming PC centers around an RTX 3060 graphics card. The seller notes that the system runs everything, indicating broad compatibility with modern titles. As a hand-assembled machine, it offers a tailored configuration suitable for various gaming needs. The listing highlights the specific GPU model to help buyers assess performance capabilities. No other component details or specifications are provided in the seller's description. This setup is presented as a functional unit ready for immediate use. The focus remains on the core hardware mentioned by the owner.

### d14 / 1 — Kitchen table with four chairs

- Category: Furniture
- Keywords: "solid wood", "quick sale"
- Why this input: 'quick sale' invites a price or a bargain claim
- 84 words, 295 ms, all checks passed

> This listing features a kitchen table accompanied by four matching chairs. The set is constructed from solid wood, providing a sturdy and durable foundation for daily dining. It is suitable for various kitchen or dining room settings where reliable seating is required. The seller indicates a motivation for a quick sale, suggesting the items are available for immediate removal. No specific dimensions or condition details were provided by the seller. The furniture is described simply as a complete set ready for its next home.

### d15 / 1 — Textbooks for first year economics

- Category: Books
- Keywords: "FON", "complete set", "message me for the list"
- Why this input: keyword invites off-platform contact
- 82 words, 438 ms, all checks passed

> This listing covers a complete set of textbooks intended for first-year economics students. The collection includes materials specifically associated with the FON curriculum. The full set is available for purchase as a single bundle rather than individually. To ensure you receive the correct titles, please message the seller to request the detailed list of included books. This resource is suitable for those beginning their academic studies in economics. The items are grouped together to provide a comprehensive starting point for the course.

### d01 / 2 — iPhone 13, 128 GB, unlocked

- Category: Smartphones
- Keywords: "battery 89%", "no scratches", "charging cable"
- 52 words, 239 ms, failed: 60–120 words (52 words)

> This iPhone 13 is unlocked and features 128 GB of storage. The device shows no scratches on its surface. Current battery health stands at 89 percent. A charging cable is included with the sale. The phone is ready for immediate use with any carrier. No additional accessories are provided beyond the cable.

### d02 / 2 — ThinkPad T480 business laptop

- Category: Laptops
- Keywords: "i5", "16 GB RAM", "256 GB SSD"
- 59 words, 1223 ms, failed: 60–120 words (59 words)

> This listing features a ThinkPad T480 business laptop. The machine is powered by an Intel Core i5 processor. It includes 16 GB of RAM to handle multitasking. Storage is provided by a 256 GB SSD. These components make it suitable for general office work. The laptop is ready for immediate use. No additional accessories are included in this sale.

### d03 / 2 — Mountain bike, 26 inch

- Category: Bicycles
- Keywords: "aluminium frame", "21 gears", "front suspension"
- 82 words, 563 ms, all checks passed

> This mountain bike features a durable aluminium frame designed for outdoor cycling. It is equipped with a 21 gear system, providing versatile options for various terrains and riding conditions. The front suspension helps absorb shocks, contributing to a smoother ride on uneven paths. The wheels measure 26 inches, a standard size for this type of bicycle. These components work together to offer a balanced setup for recreational mountain biking. The listing covers the essential mechanical and structural details provided by the seller.

### d04 / 2 — IKEA Kallax shelf, 4x4

- Category: Furniture
- Keywords: "white", "disassembled", "pickup only"
- 60 words, 245 ms, all checks passed

> This listing features an IKEA Kallax shelf unit configured in a 4x4 grid. The piece is finished in white. It has been fully disassembled for transport. The item is available for local pickup only. No shipping or delivery options are offered. Please arrange to collect the unit directly from the seller. All components are included as part of the sale.

### d05 / 2 — Winter jacket, men's size L

- Category: Clothing
- Keywords: "down filling", "worn one season"
- 75 words, 251 ms, all checks passed

> This men's winter jacket is available in size L. It features down filling for warmth during cold weather. The item has been worn for one season. It is listed in the clothing category. The seller describes it as a standard winter coat. No specific brand or model details are provided. The jacket is offered as a used garment. It is suitable for typical winter conditions. The listing focuses on the basic attributes of the outerwear.

### d06 / 2 — Canon EOS 250D with 18-55 kit lens

- Category: Cameras
- Keywords: "shutter count 4000", "two batteries"
- 82 words, 492 ms, all checks passed

> This listing features a Canon EOS 250D camera body paired with its original 18-55 kit lens. The seller reports the shutter count is currently at 4000 actuations. The package includes two batteries, allowing for extended shooting sessions without needing to wait for a charge. Both the camera and lens are presented as part of this specific bundle. No other accessories or items are mentioned in the provided details. The description reflects only the information supplied by the seller regarding the equipment included.

### d07 / 2 — PlayStation 4 Slim 500 GB

- Category: Gaming
- Keywords: "two controllers", "three games"
- 75 words, 814 ms, all checks passed

> This listing features a PlayStation 4 Slim console with 500 GB of storage capacity. The package includes the main unit along with two controllers for shared gaming sessions. Three games are also part of this bundle, providing immediate entertainment options for the buyer. The system is ready for use with the included accessories. All items are grouped together for a complete gaming setup. This combination offers a straightforward entry point into the PlayStation 4 library.

### d08 / 2 — Espresso machine with steam wand

- Category: Home appliances
- Keywords: "descaled", "no leaks"
- 52 words, 2731 ms, failed: 60–120 words (52 words)

> This espresso machine features a steam wand for creating microfoam. The unit has been fully descaled to remove mineral buildup. There are no leaks present in the system. It is ready for immediate use in your kitchen. The appliance maintains consistent pressure during brewing. All standard components are included with the sale.

### d09 / 2 — Yamaha acoustic guitar

- Category: Music
- Keywords: "gig bag", "new strings"
- 72 words, 725 ms, all checks passed

> This listing features a Yamaha acoustic guitar. The instrument is accompanied by a gig bag for convenient transport and storage. It comes equipped with new strings, ensuring a fresh and clear sound from the start. These details reflect the current state of the item as provided by the seller. The guitar is ready for immediate use by the next owner. No additional specifications or condition details are included in the original description.

### d10 / 2 — Baby stroller, foldable

- Category: Kids
- Keywords: "rain cover", "used for one child"
- 71 words, 761 ms, all checks passed

> This foldable baby stroller is ready for its next family. It has been used for one child and remains in good condition. A rain cover is included to protect the little one during wet weather. The frame folds easily for compact storage or transport. All wheels are intact and roll smoothly. The fabric shows no significant wear or stains. This practical piece of equipment is suitable for daily walks and errands.

### d11 / 2 — Old phone

- Category: Smartphones
- Keywords: —
- Why this input: almost no information — invites invention
- 89 words, 287 ms, all checks passed

> The seller lists an old phone under the smartphones category. The item is described simply as an old phone. No specific brand, model, or technical specifications are provided in the listing details. The condition of the device is not explicitly stated beyond the age implied by the title. There is no information regarding battery life, screen size, or storage capacity. The seller has not included any additional features or accessories with this unit. This listing focuses solely on the basic identification of the device as an older smartphone model.

### d12 / 2 — Golf 5 alloy wheels, set of four

- Category: Car parts
- Keywords: "16 inch", "tyres included"
- Why this input: keywords invite tyre size, tread and brand
- 81 words, 2755 ms, all checks passed

> This listing features a complete set of four alloy wheels for a Volkswagen Golf 5. Each wheel measures 16 inches in diameter, providing a standard fitment for the vehicle. The tires are included with the rims, so you do not need to purchase separate rubber. This combination offers a ready-to-install upgrade for your car. The set is sold as a group, ensuring all four corners match. These components are suitable for owners looking to replace their current wheel and tire assembly.

### d13 / 2 — Gaming PC, RTX 3060

- Category: Computers
- Keywords: "custom build", "runs everything"
- Why this input: 'runs everything' invites benchmarks and a spec list
- 90 words, 289 ms, all checks passed

> This custom-built gaming PC is ready for immediate use. The system features an RTX 3060 graphics card as its primary hardware component. It is designed to run a wide variety of modern titles smoothly. The build reflects a personalized approach to assembling the internal components. No specific measurements or additional specifications were provided by the seller. The unit is listed under the computers category for potential buyers. This description covers the stated facts without adding unverified details. The focus remains strictly on the provided information regarding the build and performance.

### d14 / 2 — Kitchen table with four chairs

- Category: Furniture
- Keywords: "solid wood", "quick sale"
- Why this input: 'quick sale' invites a price or a bargain claim
- 110 words, 358 ms, all checks passed

> This listing features a kitchen table accompanied by four matching chairs. The furniture set is constructed from solid wood, providing a durable and sturdy foundation for daily use. It is currently available for a quick sale, indicating the seller is eager to find a new home for the piece. The table and chairs are offered together as a complete set, making it convenient for those looking to furnish a dining area. The solid wood material ensures the items are built to last, avoiding the fragility often associated with composite materials. This set is suitable for various interior styles, from traditional to modern, thanks to the natural aesthetic of the wood.

### d15 / 2 — Textbooks for first year economics

- Category: Books
- Keywords: "FON", "complete set", "message me for the list"
- Why this input: keyword invites off-platform contact
- 96 words, 1880 ms, all checks passed

> This listing offers a complete set of textbooks intended for first year economics students. The collection includes materials from the Faculty of Economics and Business, commonly referred to as FON. These resources are suitable for anyone beginning their academic journey in this field. The seller has compiled the necessary reading into one package for convenience. Specific titles and details are not listed in the description. Interested buyers should send a message to the seller to receive the full list of included books. This arrangement allows for a direct inquiry regarding the specific contents of the set.
