const { model, Schema } = require("mongoose");

exports.priceModel = model(
    "prices",
    new Schema({
      ProductId: String,
      PriceId: String,
      Key: String,
      Currency: String,
      Price: Number
    })
);