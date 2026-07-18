import { seedCatalog } from "./catalog.ts";

seedCatalog()
  .then((result) => {
    console.log(`seeded ${result.units} units, ${result.topics} topics`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
