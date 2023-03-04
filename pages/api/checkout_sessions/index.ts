import { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { connectDatabase, insertData } from "utils/db-utils";
import { createUserOrdersFromAuth } from "utils/firebase";
import { ItemPropsType } from "utils/types";

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

type Res = {
  session?: Stripe.Checkout.Session;
  message?: string;
  statusCode?: number;
  products?: [];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Res>) {
  if (req.method === "POST") {
    let session;
    try {
      const sessionItem = {
        mode: "payment",
        submit_type: "pay",
        payment_method_types: ["card"],
        billing_address_collection: "auto",
        line_items: req.body.items.map((item: ItemPropsType) => ({
          price: item.id,
          quantity: item.qty,
        })),
        success_url: `${req.headers.origin}/success?sessionId={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}/`,
      };
      session = await stripe.checkout.sessions.create(sessionItem);
      res.status(200).json({ session });
    } catch (err: any) {
      console.error("error! : " + err.message); // alert don't work in server side
      throw new Error(err);
    }

    await createUserOrdersFromAuth(session, {
      ...req.body.userDetails,
      "purchased-items": { ...req.body.items },
    });

    // send decreased items to mongodb via :
    let client;
    try {
      client = await connectDatabase();
    } catch (error: any) {
      console.error(error.message);
      throw new Error(error);
    }
    try {
      const newChangedData: ItemPropsType[] = [];
      const { preExistData } = req.body;
      // localProducts here is not same to products; Next has changed Img urls
      // so when fetching data back from mongodb don't use data's imgUrl
      const tempLocalProductsId: string[] = [];
      const bodyItems = req.body.items;

      for (let i = 0; i < bodyItems.length; i += 1) {
        for (let j = 0; j < preExistData.length; j += 1) {
          if (bodyItems[i].id === preExistData[j].id) {
            newChangedData.push({ ...preExistData[j], total: bodyItems[i].total });
            tempLocalProductsId.push(bodyItems[i].id);
          }
        }
      }
      for (let i = 0; i < preExistData.length; i += 1)
        if (!tempLocalProductsId.includes(preExistData[i].id)) {
          newChangedData.push(preExistData[i]);
          tempLocalProductsId.push(preExistData[i].id);
        }

      let result;
      result = await insertData(client, "products", newChangedData as []);
      // res.status(200).json({ message: "Products uploaded to mongodb!", products: newChangedData as [] });
    } catch (error: any) {
      console.error("error is : ", error.message);
      // res.status(500).json({ statusCode: 500, message: (error as unknown as Error).message });
    }
    client.close();
  } else {
    // res.setHeader("Allow", "POST");
    res.status(405).end("Method Not Allowed");
  }
}
