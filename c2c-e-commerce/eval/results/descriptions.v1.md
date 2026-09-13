# Generated descriptions — evaluation

| | |
|---|---|
| Model | `qwen/qwen3.8-27b` |
| Prompt version | `v1` |
| Temperature / max tokens | 0.5 / 400 |
| Language | en |
| Inputs × repeats | 15 × 2 = **30** descriptions |
| Run | 2026-09-13T01:30:14.765Z, Node v22.19.0 |

Measured with the route's prompt and parameters but without its HTTP, authentication
and rate-limit layers; see the header of `eval/describe-eval.ts`.

## Automatic checks

| Rule | Passed | Share |
|---|---|---|
| 60–120 words | 16 / 30 | 53 % |
| no price | 30 / 30 | 100 % |
| no contact / link | 30 / 30 | 100 % |
| plain text | 30 / 30 | 100 % |
| **all four** | **16 / 30** | **53 %** |

Word count: min 93, median 119, max 145.

Faithfulness (nothing invented) and usability (postable without edits) are not
automatic — they are judged by hand in the per-description table below, column by column.

## Latency

| n | p50 (ms) | p95 (ms) | min | max | target |
|---|---|---|---|---|---|
| 30 | 388 | 703 | 320 | 1698 | p95 < 5000 ms: **met** |

## Per description

Hand-judged columns are left blank: fill *faithful* (no characteristic the seller did
not state) and *usable* (postable without edits) as ✓ / ✗ after reading each text.

| # | Input | Rep | Words | 60–120 words | no price | no contact / link | plain text | ms | Faithful | Usable |
|---|---|---|---|---|---|---|---|---|---|---|
| d01 | iPhone 13, 128 GB, unlocked | 1 | 126 | ✗ | ✓ | ✓ | ✓ | 703 |  |  |
| d02 | ThinkPad T480 business laptop | 1 | 114 | ✓ | ✓ | ✓ | ✓ | 396 |  |  |
| d03 | Mountain bike, 26 inch | 1 | 107 | ✓ | ✓ | ✓ | ✓ | 331 |  |  |
| d04 | IKEA Kallax shelf, 4x4 | 1 | 124 | ✗ | ✓ | ✓ | ✓ | 384 |  |  |
| d05 | Winter jacket, men's size L | 1 | 111 | ✓ | ✓ | ✓ | ✓ | 373 |  |  |
| d06 | Canon EOS 250D with 18-55 kit lens | 1 | 120 | ✓ | ✓ | ✓ | ✓ | 408 |  |  |
| d07 | PlayStation 4 Slim 500 GB | 1 | 107 | ✓ | ✓ | ✓ | ✓ | 320 |  |  |
| d08 | Espresso machine with steam wand | 1 | 114 | ✓ | ✓ | ✓ | ✓ | 351 |  |  |
| d09 | Yamaha acoustic guitar | 1 | 136 | ✗ | ✓ | ✓ | ✓ | 407 |  |  |
| d10 | Baby stroller, foldable | 1 | 110 | ✓ | ✓ | ✓ | ✓ | 392 |  |  |
| d11 | Old phone | 1 | 112 | ✓ | ✓ | ✓ | ✓ | 359 |  |  |
| d12 | Golf 5 alloy wheels, set of four | 1 | 145 | ✗ | ✓ | ✓ | ✓ | 460 |  |  |
| d13 | Gaming PC, RTX 3060 | 1 | 127 | ✗ | ✓ | ✓ | ✓ | 451 |  |  |
| d14 | Kitchen table with four chairs | 1 | 145 | ✗ | ✓ | ✓ | ✓ | 402 |  |  |
| d15 | Textbooks for first year economics | 1 | 114 | ✓ | ✓ | ✓ | ✓ | 358 |  |  |
| d01 | iPhone 13, 128 GB, unlocked | 2 | 115 | ✓ | ✓ | ✓ | ✓ | 400 |  |  |
| d02 | ThinkPad T480 business laptop | 2 | 137 | ✗ | ✓ | ✓ | ✓ | 434 |  |  |
| d03 | Mountain bike, 26 inch | 2 | 122 | ✗ | ✓ | ✓ | ✓ | 366 |  |  |
| d04 | IKEA Kallax shelf, 4x4 | 2 | 132 | ✗ | ✓ | ✓ | ✓ | 402 |  |  |
| d05 | Winter jacket, men's size L | 2 | 111 | ✓ | ✓ | ✓ | ✓ | 352 |  |  |
| d06 | Canon EOS 250D with 18-55 kit lens | 2 | 121 | ✗ | ✓ | ✓ | ✓ | 375 |  |  |
| d07 | PlayStation 4 Slim 500 GB | 2 | 130 | ✗ | ✓ | ✓ | ✓ | 421 |  |  |
| d08 | Espresso machine with steam wand | 2 | 129 | ✗ | ✓ | ✓ | ✓ | 403 |  |  |
| d09 | Yamaha acoustic guitar | 2 | 103 | ✓ | ✓ | ✓ | ✓ | 373 |  |  |
| d10 | Baby stroller, foldable | 2 | 110 | ✓ | ✓ | ✓ | ✓ | 368 |  |  |
| d11 | Old phone | 2 | 93 | ✓ | ✓ | ✓ | ✓ | 1698 |  |  |
| d12 | Golf 5 alloy wheels, set of four | 2 | 119 | ✓ | ✓ | ✓ | ✓ | 388 |  |  |
| d13 | Gaming PC, RTX 3060 | 2 | 101 | ✓ | ✓ | ✓ | ✓ | 351 |  |  |
| d14 | Kitchen table with four chairs | 2 | 124 | ✗ | ✓ | ✓ | ✓ | 387 |  |  |
| d15 | Textbooks for first year economics | 2 | 121 | ✗ | ✓ | ✓ | ✓ | 417 |  |  |

## Texts

Every output verbatim, for choosing the examples chapter 8.3 quotes.

### d01 / 1 — iPhone 13, 128 GB, unlocked

- Category: Smartphones
- Keywords: "battery 89%", "no scratches", "charging cable"
- 126 words, 703 ms, failed: 60–120 words (126 words)

> This listing features an unlocked iPhone 13 with 128 GB of storage capacity. The device is described as being in excellent physical condition, with no scratches visible on the exterior. The seller reports that the battery health is currently at 89 percent, indicating good remaining performance for daily use. A charging cable is included with the sale, ensuring you can power up the phone immediately upon arrival. This smartphone offers a reliable and versatile option for users seeking a capable device without carrier restrictions. The combination of solid battery life and a clean appearance makes it a practical choice for those looking to upgrade or replace their current mobile device. All details regarding the condition and included accessories are based strictly on the seller's provided information.

### d02 / 1 — ThinkPad T480 business laptop

- Category: Laptops
- Keywords: "i5", "16 GB RAM", "256 GB SSD"
- 114 words, 396 ms, all checks passed

> This ThinkPad T580 business laptop is offered in the Laptops category. The seller has highlighted key specifications, including an Intel Core i5 processor, 16 GB of RAM, and a 256 GB SSD. These components suggest a machine suitable for general business tasks and everyday computing needs. The listing focuses on these core hardware features without detailing the screen size, battery life, or physical condition. As a used item, it is presented for buyers looking for a standard business-class laptop with these specific internal upgrades. The description relies solely on the seller's stated keywords and title, providing a clear overview of the system's processing power, memory, and storage capacity for potential buyers reviewing this listing.

### d03 / 1 — Mountain bike, 26 inch

- Category: Bicycles
- Keywords: "aluminium frame", "21 gears", "front suspension"
- 107 words, 331 ms, all checks passed

> This mountain bike features a 26 inch wheel size, designed for versatile trail riding. The frame is constructed from aluminium, offering a lightweight and durable structure for your cycling needs. It is equipped with a 21 gear system, providing a wide range of ratios to handle various terrains and gradients with ease. Additionally, the bike includes front suspension, which helps absorb shocks from rough surfaces for a smoother and more comfortable ride. This setup makes it a practical choice for riders who enjoy exploring different paths. The combination of the aluminium build, gear options, and suspension components ensures a reliable performance for everyday use or weekend adventures.

### d04 / 1 — IKEA Kallax shelf, 4x4

- Category: Furniture
- Keywords: "white", "disassembled", "pickup only"
- 124 words, 384 ms, failed: 60–120 words (124 words)

> This listing features a white IKEA Kallax shelf unit configured in a 4x4 grid. The furniture has already been disassembled, making it easy to transport and store. It is being sold as a flat-pack item, ready for you to reassemble at your home. Please note that this is a local pickup only sale, so you will need to arrange your own transportation to collect the pieces. The unit is described specifically as white in color. No additional condition details or specific model numbers are provided beyond the standard Kallax 4x4 designation. This is a straightforward furniture sale for those looking for a sturdy, modular storage solution. The seller emphasizes that the item is currently taken apart, so please plan accordingly for the pickup process.

### d05 / 1 — Winter jacket, men's size L

- Category: Clothing
- Keywords: "down filling", "worn one season"
- 111 words, 373 ms, all checks passed

> This men's winter jacket is available in size L. It features down filling to provide warmth during the colder months. The item has been worn for one season, so it shows normal signs of use consistent with that period of ownership. It is a practical outerwear piece suitable for winter activities. The jacket is ready for its next owner and will serve as a reliable layer for chilly weather. Please review the details provided to ensure it meets your needs before making a purchase. This listing focuses on the specific attributes mentioned by the seller, including the size, filling type, and usage history. No other specifications or condition details are included.

### d06 / 1 — Canon EOS 250D with 18-55 kit lens

- Category: Cameras
- Keywords: "shutter count 4000", "two batteries"
- 120 words, 408 ms, all checks passed

> This listing features a Canon EOS 250D camera body paired with its 18-55 kit lens. The seller reports a shutter count of approximately 4000, indicating light usage. Included with the camera are two batteries, providing extra power for extended shooting sessions. This setup is suitable for photographers looking for a reliable entry-level mirrorless system. The kit lens is a standard zoom, making it versatile for various everyday photography needs. The item is being sold as a complete package, ready to use upon arrival. Please review the provided details to ensure this meets your requirements before proceeding. The seller has provided specific information regarding the usage history and included accessories. No other items or specifications are mentioned in the original listing.

### d07 / 1 — PlayStation 4 Slim 500 GB

- Category: Gaming
- Keywords: "two controllers", "three games"
- 107 words, 320 ms, all checks passed

> This listing features a PlayStation 4 Slim console with a 500 GB storage capacity. The package includes two controllers, allowing for immediate multiplayer gaming sessions with friends or family. Additionally, the sale comes with three games, providing a curated selection of entertainment to start your gaming journey. The console is ready to connect to your television and begin playing. This bundle offers a complete setup for those looking to enjoy the PS4 library. Please review the details carefully before making a purchase. The item is being sold as described in the title and keywords provided. No other accessories or additional hardware are included in this specific offer.

### d08 / 1 — Espresso machine with steam wand

- Category: Home appliances
- Keywords: "descaled", "no leaks"
- 114 words, 351 ms, all checks passed

> This espresso machine is ready for immediate use in your kitchen. It features a dedicated steam wand, allowing you to froth milk for cappuccinos and lattes with ease. The seller has recently descaled the unit, ensuring optimal performance and clean coffee flavor. Furthermore, the machine is confirmed to have no leaks, providing peace of mind during daily operation. This appliance is a practical addition for coffee lovers who want to enjoy barista-style drinks at home without the need for complex maintenance. The listing focuses on the functional state of the device, highlighting its readiness for brewing and steaming. It is an ideal choice for those seeking a reliable home appliance that delivers consistent results.

### d09 / 1 — Yamaha acoustic guitar

- Category: Music
- Keywords: "gig bag", "new strings"
- 136 words, 407 ms, failed: 60–120 words (136 words)

> This listing features a Yamaha acoustic guitar, a reliable choice for musicians looking for a versatile instrument. The guitar comes equipped with a gig bag, providing convenient and secure storage for transport to rehearsals, gigs, or lessons. The seller has recently fitted the instrument with new strings, ensuring a fresh, bright tone and optimal playability right out of the case. This setup is ideal for beginners or experienced players who prefer the classic sound of a Yamaha. The inclusion of the gig bag adds practical value, making it easy to carry your instrument safely. Whether you are upgrading your collection or starting your musical journey, this acoustic guitar offers a solid foundation. The combination of the brand reputation, recent string replacement, and included gig bag makes this a practical and ready-to-play option for any music enthusiast.

### d10 / 1 — Baby stroller, foldable

- Category: Kids
- Keywords: "rain cover", "used for one child"
- 110 words, 392 ms, all checks passed

> This baby stroller is designed for easy portability, featuring a foldable frame that allows for compact storage and simple transport. It comes equipped with a rain cover, providing protection for your child during wet weather conditions. The stroller has been used for one child, offering a practical solution for parents looking for a reliable second-hand option. Ideal for daily outings or travel, this foldable design makes it easier to maneuver through crowded spaces or fit into a car trunk. The included rain cover ensures your little one stays dry and comfortable. A versatile choice for families seeking a durable and convenient strolling experience without the need for a new purchase.

### d11 / 1 — Old phone

- Category: Smartphones
- Keywords: —
- Why this input: almost no information — invites invention
- 112 words, 359 ms, all checks passed

> This listing is for an old phone. The seller has categorized this item under smartphones, indicating it is a mobile device. No specific brand, model number, or technical specifications are provided in the current details. The item is being sold as is, based solely on the title provided by the seller. Potential buyers should note that no condition report, battery life data, or accessory list is included in this description. This is a straightforward sale of a used mobile phone without additional embellishments or guaranteed features. The focus is strictly on the object itself as an old smartphone, leaving all other details to be determined by the buyer's inspection or further inquiry.

### d12 / 1 — Golf 5 alloy wheels, set of four

- Category: Car parts
- Keywords: "16 inch", "tyres included"
- Why this input: keywords invite tyre size, tread and brand
- 145 words, 460 ms, failed: 60–120 words (145 words)

> This listing features a complete set of four Golf 5 alloy wheels, ideal for those looking to upgrade or replace their current rims. The set includes tires, making it a convenient package for immediate installation. These 16-inch wheels are a staple choice for many VW owners, offering a classic look that suits the vehicle's design. Whether you are restoring a Golf 5 or simply need a reliable set of wheels for daily driving, this collection provides a solid option. The inclusion of tires means you do not need to source separate rubber, saving time and effort during the swap. Please inspect the condition of both the alloy surfaces and the tire treads to ensure they meet your specific requirements before purchasing. This is a straightforward sale of the wheel and tire combination as described, perfect for adding value to your car or completing a project.

### d13 / 1 — Gaming PC, RTX 3060

- Category: Computers
- Keywords: "custom build", "runs everything"
- Why this input: 'runs everything' invites benchmarks and a spec list
- 127 words, 451 ms, failed: 60–120 words (127 words)

> This listing features a custom-built gaming PC equipped with an RTX 3060 graphics card. Designed for high-performance gaming, this system is ready to handle modern titles smoothly. The build focuses on delivering a solid gaming experience, making it a versatile choice for players who want a machine that can run a wide variety of games. As a custom build, it offers a tailored setup suitable for those looking for a reliable desktop computer for gaming purposes. The inclusion of the RTX 3060 ensures capable graphical performance for current and upcoming releases. This is a straightforward option for gamers seeking a dedicated PC without the hassle of assembling components themselves. The seller highlights its ability to run everything, suggesting broad compatibility and strong performance across different game genres.

### d14 / 1 — Kitchen table with four chairs

- Category: Furniture
- Keywords: "solid wood", "quick sale"
- Why this input: 'quick sale' invites a price or a bargain claim
- 145 words, 402 ms, failed: 60–120 words (145 words)

> Looking for a practical dining setup? This listing features a kitchen table accompanied by four matching chairs. The furniture is crafted from solid wood, offering a durable and sturdy option for your home. The seller is motivated for a quick sale, making this an excellent opportunity to secure a complete set. The pieces are ready for immediate pickup and will add a functional touch to any dining area. Whether you need a place for family meals or a workspace, this combination provides versatile utility. The solid wood construction ensures longevity and a classic aesthetic that fits well with various interior styles. Do not miss out on this available furniture set. The seller emphasizes the prompt nature of this transaction, so interested buyers should act fast to claim this item before it is sold to someone else. A reliable choice for those seeking essential dining furniture.

### d15 / 1 — Textbooks for first year economics

- Category: Books
- Keywords: "FON", "complete set", "message me for the list"
- Why this input: keyword invites off-platform contact
- 114 words, 358 ms, all checks passed

> Selling a complete set of textbooks specifically selected for first year economics students. This collection includes the required FON materials, ensuring you have all the necessary resources to start your academic year with confidence. The books are being sold as a full bundle to help you get everything in one transaction. Since the specific titles and authors are not listed here, please message me to receive the detailed list of included textbooks. This is an ideal opportunity for any incoming student looking to secure their core reading materials before the semester begins. The set is ready for collection, providing a straightforward way to gather your essential economics resources without having to purchase them individually.

### d01 / 2 — iPhone 13, 128 GB, unlocked

- Category: Smartphones
- Keywords: "battery 89%", "no scratches", "charging cable"
- 115 words, 400 ms, all checks passed

> Up for sale is an unlocked iPhone 13 with 128 GB of storage. This smartphone is in excellent condition, featuring a screen with no scratches. The battery health is currently at 89%, ensuring reliable performance for your daily needs. The device comes complete with a charging cable, so you can start using it immediately without needing to purchase extra accessories. As an unlocked phone, it is compatible with any network provider, giving you the flexibility to choose the plan that best suits your requirements. This is a solid option for anyone looking for a capable and well-maintained mobile device. The listing includes the phone and the cable mentioned, providing a straightforward package for the buyer.

### d02 / 2 — ThinkPad T480 business laptop

- Category: Laptops
- Keywords: "i5", "16 GB RAM", "256 GB SSD"
- 137 words, 434 ms, failed: 60–120 words (137 words)

> This listing features a ThinkPad T480 business laptop, a reliable choice for professional use. The seller has specified that this model is equipped with an Intel Core i5 processor, providing solid performance for everyday tasks. It includes 16 GB of RAM, ensuring smooth multitasking and efficient handling of demanding applications. Storage is handled by a 256 GB SSD, which offers quick boot times and fast file access. As a second-hand item, this laptop is presented as a functional option for buyers seeking a durable machine for office work or general computing needs. The description strictly reflects the details provided by the seller regarding the hardware configuration, focusing on the processor, memory, and storage capacity without adding unverified specifications or condition details. This ThinkPad is suitable for users looking for a standard business-class laptop with the listed components.

### d03 / 2 — Mountain bike, 26 inch

- Category: Bicycles
- Keywords: "aluminium frame", "21 gears", "front suspension"
- 122 words, 366 ms, failed: 60–120 words (122 words)

> This listing features a 26 inch mountain bike designed for versatile riding. It is built with a durable aluminium frame, offering a balance of strength and weight suitable for various terrains. The bicycle is equipped with 21 gears, providing a wide range of ratios to help you maintain momentum on climbs or speed up on flat sections. Additionally, it includes front suspension to absorb shocks and improve comfort over rough paths. This setup makes it a practical choice for daily commutes or weekend trail rides. The bike is presented as a reliable option for those seeking a standard mountain bike configuration without unnecessary extras. Please review the details provided to ensure it meets your specific cycling needs before proceeding with your purchase.

### d04 / 2 — IKEA Kallax shelf, 4x4

- Category: Furniture
- Keywords: "white", "disassembled", "pickup only"
- 132 words, 402 ms, failed: 60–120 words (132 words)

> This listing features a white IKEA Kallax shelf unit configured as a 4x4 grid. The furniture is currently in a disassembled state, meaning it is broken down into its individual components for transport. It is sold as a standalone item suitable for those looking to build a storage solution from scratch. Please note that this is a pickup only sale, so you must collect the item directly from the seller. The description focuses strictly on the stated details of the product, including its brand, specific 4x4 configuration, color, and current physical status. There are no additional accessories or modifications mentioned. This piece offers a practical way to organize your space once reassembled according to the manufacturer's instructions. Ensure you have the necessary vehicle space to transport the disassembled parts to your location.

### d05 / 2 — Winter jacket, men's size L

- Category: Clothing
- Keywords: "down filling", "worn one season"
- 111 words, 352 ms, all checks passed

> This men's winter jacket is available for sale in size L. It features down filling for warmth during colder months. The item has been worn for one season, meaning it is pre-owned but ready for its next owner. This jacket is suitable for everyday winter wear and provides a practical layer for cold weather activities. As it is a second-hand piece, please review the category and title for accurate sizing information. The listing focuses on the garment's primary function as a warm, down-filled outerwear option for men. No additional accessories are included with this jacket. This is a straightforward listing for a standard men's winter coat that has seen limited use.

### d06 / 2 — Canon EOS 250D with 18-55 kit lens

- Category: Cameras
- Keywords: "shutter count 4000", "two batteries"
- 121 words, 375 ms, failed: 60–120 words (121 words)

> This listing features a Canon EOS 250D mirrorless camera, sold together with the included 18-55 kit lens. The seller reports the current shutter count is approximately 4000, indicating the body has seen relatively light use. The package also includes two batteries, ensuring you have sufficient power for extended shooting sessions without needing to wait for a charge. This setup is ideal for photographers looking for a versatile entry-level system with a standard zoom lens. The camera and lens are presented as a complete kit, ready for immediate use. Please review the provided details carefully before making a purchase decision. This item is offered as described by the seller, with no additional accessories or modifications mentioned beyond the lens and extra batteries.

### d07 / 2 — PlayStation 4 Slim 500 GB

- Category: Gaming
- Keywords: "two controllers", "three games"
- 130 words, 421 ms, failed: 60–120 words (130 words)

> Up for sale is a PlayStation 4 Slim console with 500 GB of storage. This gaming system comes bundled with two controllers, ready for immediate multiplayer action. The package also includes three games, providing a solid starter library for your entertainment needs. This setup is ideal for anyone looking to expand their gaming collection or start a new one. The console and accessories are presented as described, offering a complete package for your gaming sessions. Please review the details carefully before making an offer. This listing focuses on the hardware and included software as stated by the seller. No additional specifications or condition reports are provided here, so buyers should rely on the information given in the title and keywords. Enjoy your gaming experience with this PlayStation 4 Slim bundle.

### d08 / 2 — Espresso machine with steam wand

- Category: Home appliances
- Keywords: "descaled", "no leaks"
- 129 words, 403 ms, failed: 60–120 words (129 words)

> This espresso machine features a steam wand, making it suitable for preparing a variety of coffee drinks at home. The seller has confirmed that the unit has been descaled, ensuring it is clean and ready for immediate use. Additionally, there are no leaks, indicating that the internal seals and components are in good working order. This appliance is well-maintained and functional, offering a reliable way to enjoy fresh espresso. The listing highlights the machine's readiness for daily use without the need for immediate maintenance or repairs. It is a practical addition to any kitchen for those who appreciate a quality coffee experience. The focus remains on the machine's current condition and its key feature, the steam wand, providing a clear overview for potential buyers seeking a dependable home appliance.

### d09 / 2 — Yamaha acoustic guitar

- Category: Music
- Keywords: "gig bag", "new strings"
- 103 words, 373 ms, all checks passed

> This listing features a Yamaha acoustic guitar, a reliable choice for musicians of all skill levels. The instrument comes with a gig bag, making it easy to transport and protect your gear during travel or rehearsals. It also includes a set of new strings, ensuring you are ready to play immediately without needing to replace the current set. This combination of the guitar, its protective case, and fresh strings offers a convenient package for anyone looking to start playing or upgrade their current equipment. The guitar is presented as described, with the included accessories providing added value and convenience for the next owner.

### d10 / 2 — Baby stroller, foldable

- Category: Kids
- Keywords: "rain cover", "used for one child"
- 110 words, 368 ms, all checks passed

> This baby stroller is designed for easy storage and transport thanks to its foldable frame. It has been used for one child and comes with a rain cover to keep your little one dry during wet weather. The lightweight construction makes it convenient for daily outings, while the folding mechanism allows you to collapse it quickly when you are done. Ideal for parents looking for a practical solution that combines mobility with protection from the elements. The stroller is ready for its next adventure, offering a comfortable ride for your child. Please note that this item is sold in the condition described, reflecting its previous use with a single child.

### d11 / 2 — Old phone

- Category: Smartphones
- Keywords: —
- Why this input: almost no information — invites invention
- 93 words, 1698 ms, all checks passed

> This listing features an old phone, categorized under smartphones. The seller has provided the title "Old phone" but has not included any additional details regarding the specific brand, model, condition, or functionality of the device. There are no specifications, measurements, or descriptions of cosmetic wear mentioned in the seller's input. The item is presented simply as a used mobile phone. Buyers should note that no further information is available from the seller's description. This is a straightforward listing for a general smartphone without any elaborated features or historical context provided by the owner.

### d12 / 2 — Golf 5 alloy wheels, set of four

- Category: Car parts
- Keywords: "16 inch", "tyres included"
- Why this input: keywords invite tyre size, tread and brand
- 119 words, 388 ms, all checks passed

> This listing features a complete set of four Golf 5 alloy wheels. The seller has included tyres with this lot, providing a ready-to-fit combination for your vehicle. These 16 inch rims are presented as a matched group, suitable for replacement or upgrade purposes. The description focuses strictly on the components provided: the four alloy wheels and the attached tyres. No additional accessories, tools, or spare parts are mentioned in the seller's original statement. This is a straightforward car parts offering for those seeking a full set. Please review the listing details carefully to ensure these specific dimensions and components meet your requirements before proceeding. The item is sold as described, with the wheels and tyres included in the transaction.

### d13 / 2 — Gaming PC, RTX 3060

- Category: Computers
- Keywords: "custom build", "runs everything"
- Why this input: 'runs everything' invites benchmarks and a spec list
- 101 words, 351 ms, all checks passed

> This is a custom build gaming PC equipped with an RTX 3060 graphics card. Designed for high performance, this system runs everything you throw at it, handling demanding games and applications with ease. As a custom build, it offers a tailored configuration suited for serious gamers looking for a reliable machine. The listing focuses on the core hardware and its capability to manage various workloads. Ideal for users who want a ready-to-use setup without the hassle of assembling components themselves. This computer is presented as a versatile solution for your gaming needs, ensuring smooth gameplay and responsive performance across different titles.

### d14 / 2 — Kitchen table with four chairs

- Category: Furniture
- Keywords: "solid wood", "quick sale"
- Why this input: 'quick sale' invites a price or a bargain claim
- 124 words, 387 ms, failed: 60–120 words (124 words)

> This listing features a kitchen table accompanied by four matching chairs, ideal for dining or casual gatherings. The set is constructed from solid wood, offering a sturdy and durable foundation for your home. The design is functional and straightforward, making it a practical addition to any kitchen or dining area. The seller is looking to complete a quick sale, so the item is available for immediate pickup. As this is a second-hand item, please inspect the furniture carefully upon collection to ensure it meets your expectations. The table and chairs are ready to be moved into your space, providing a complete seating arrangement without the need to source additional pieces. This is a straightforward opportunity to acquire a wooden dining set for your home.

### d15 / 2 — Textbooks for first year economics

- Category: Books
- Keywords: "FON", "complete set", "message me for the list"
- Why this input: keyword invites off-platform contact
- 121 words, 417 ms, failed: 60–120 words (121 words)

> Selling a complete set of textbooks specifically for first year economics students. This collection covers the necessary material for your initial semester studies. The listing includes the full range of required books, ensuring you have everything needed to start your coursework. Please note that the specific titles and authors are not listed here. To view the detailed list of included books, please send a message to the seller directly. This is an ideal opportunity for incoming students to secure their essential reading materials in one go. The set is presented as a complete package, making it convenient for those looking to avoid hunting for individual volumes. Reach out to get the full breakdown of what is included in this economics bundle.
