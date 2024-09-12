require("dotenv").config();

const stripe = require("stripe")(process.env.StripeKey);
const { connect } = require("mongoose");
const { priceModel } = require("./shemas.js");

(async () => {
    await connect(process.env.URIMongoDB, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    })
    .then(() => console.log("Connected to MongoDB"))
    .catch(() =>
        console.log("An error has occured with MongoDB")
    );

    const products = await stripe.products.list({ active: true, limit: 100 });

    for (const product of products.data) {
        console.log(`Running for ${product.name}...`);

        const prices = await stripe.prices.list({
            active: true,
            product: product.id,
            limit: 100
        });

        let currencies = ["EUR", "PLN", "GBP", "TRY", "USD", "AUD", "DKK", "CAD", "NOK", "SEK", "NZD"];

        for (let price of prices.data) {

            if (currencies.includes(price.currency.toUpperCase())) {
                currencies = currencies.filter(currency => currency != price.currency.toUpperCase());
            }
        }

        console.log(`Currencies to create: ${currencies.join(", ")}`);

        for (const currency of currencies) {
            const price = await stripe.prices.create({
                product: product.id,
                unit_amount: 100,
                currency: currency.toLowerCase(),
                metadata: {
                    key: product.metadata.key
                }
            });

            const priceDB = new priceModel({
                ProductId: product.id,
                PriceId: price.id,
                Key: product.metadata.key,
                Currency: currency.toUpperCase(),
                Price: price.unit_amount / 100
            });
            await priceDB.save();

            console.log(`Created ${currency} price for ${product.name}`);
        }

        console.log(`Finished for ${product.name}!`);
    }
})()