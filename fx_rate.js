require("dotenv").config();

const stripe = require("stripe")(process.env.StripeKey);
const { connect } = require("mongoose");
const fetch = require("node-fetch");
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

    await updatePricing();

    resetAtMidnight();
})()

function resetAtMidnight() {
    const now = new Date();
    const night = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0, 0, 0
    );
    const msToMidnight = night.getTime() - now.getTime();

    setTimeout(async function() {
        try {
            await updatePricing();
            console.log(`${new Date().toLocaleString("fr-FR")} - Prices updated!`);
        } catch {
            console.log(`${new Date().toLocaleString("fr-FR")} - Unable to update prices.`);
        }
        
        resetAtMidnight();
    }, msToMidnight);
}

async function updatePricing() {
    const currencies = ["PLN", "GBP", "TRY", "USD", "AUD", "DKK", "CAD", "NOK", "SEK", "NZD"];

    let productsInEUR = await priceModel.aggregate([
        { $match: { Currency: "EUR" } },
        {
            $group: {
                _id: "$Key",
                Price: { $last: "$Price" }
            }
        },
        {
            $group: {
                _id: null,
                keyPricePairs: {
                    $push: {
                        k: "$_id",
                        v: "$Price"
                    }
                }
            }
        },
        {
            $replaceRoot: {
                newRoot: { $arrayToObject: "$keyPricePairs" }
            }
        }
    ]);
    productsInEUR = productsInEUR[0];

    const exchangeRatesData = await fetch(`https://api.apilayer.com/exchangerates_data/latest?symbols=${currencies.join(",")}&base=EUR`, {
        headers: {
            "apikey": process.env.APILayerKey
        }
    })
    .then(res => res.json());

    for (currency of currencies) {
        const products = await priceModel.find({ Currency: currency });
        console.log(`Updating prices for ${currency}...`);

        for (product of products) {
            const newPriceInEURBase = productsInEUR[product.Key] * exchangeRatesData.rates[currency];
            let newPriceInCurrency = roundUpWithCents(newPriceInEURBase);

            if (newPriceInCurrency != product.Price) {
                await stripe.prices.update(product.PriceId, {
                    active: false
                });

                let newPriceId = "";

                const priceExists = await stripe.prices.search({
                    query: `metadata['key']:'${product.Key}' AND currency:'${currency.toLowerCase()}'`,
                    limit: 100
                });

                while (priceExists.has_more) {
                    const morePrices = await stripe.prices.search({
                        query: `metadata['key']:'${product.Key}' AND currency:'${currency.toLowerCase()}'`,
                        limit: 100,
                        starting_after: priceExists.data[priceExists.data.length - 1].id
                    });

                    priceExists.data = priceExists.data.concat(morePrices.data);
                }

                for (price of priceExists.data) {
                    if (price.unit_amount_decimal / 100 == newPriceInCurrency) {
                        await stripe.prices.update(price.id, {
                            active: true
                        });
                        
                        console.log(`Updating ${product.Key} from ${product.Price} ${product.Currency} to ${newPriceInCurrency} ${currency}`);

                        newPriceId = price.id;
                        break;
                    }
                }
                
                if (!newPriceId) {
                    const newPrice = await stripe.prices.create({
                        product: product.ProductId,
                        unit_amount: newPriceInCurrency * 100,
                        currency: currency.toLowerCase(),
                        metadata: {
                            key: product.Key
                        }
                    });

                    newPriceId = newPrice.id;

                    console.log(`Updating ${product.Key} from ${product.Price} ${product.Currency} to ${newPriceInCurrency} ${currency}`); 
                }

                await priceModel.updateOne({ Key: product.Key, Currency: currency }, { PriceId: newPriceId, Price: newPriceInCurrency });
            }
        }

        console.log(`Prices updated for ${currency}!`);
    }
}


function roundUpWithCents(number) {
    const integerPart = Math.floor(number);
    const decimalPart = number - integerPart;

    if (decimalPart == 0) {
        return integerPart;
    } else if (decimalPart <= 0.5) {
        return integerPart + 0.5;
    } else {
        return integerPart + 1;
    }
}