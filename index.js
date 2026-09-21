const express = require('express');
const cors = require('cors')
const app = express()
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000
const crypto = require('crypto');

const admin = require("firebase-admin");
// console.log(admin);
// console.log(admin.credential);
const serviceAccount = require("./zap-shift-cc.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const generateTrackingId = () => {
    const prefix = 'TRK';

    const date = new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '')
        .slice(2);

    const random = crypto
        .randomBytes(2)
        .toString('hex')
        .toUpperCase();

    return `${prefix}-${date}-${random}`;
};
const stripe = require('stripe')(process.env.STRIPE_SECRET);
// middleware
app.use(express.json())
app.use(cors())
const verifyFBToken = async(req,res,next) =>{
  console.log('Headers in middlwear', req.headers.authorization);
  const token = req.headers.authorization;
  if(!token){
    return res.status(401).send({message: 'unauthorized access'})
  }
  try{
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('Decoded Id token', decoded)
    req.decoded_email = decoded.email;
    next()
  }
  catch(err){
    return res.status(401).send({message: 'unauthorizes access'})
  }
  
}
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gbbfjrz.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('zap-shif-client')
    const usersCollection = db.collection('users')
    const ridersCollection = db.collection('riders')
    const parcelsCollection = db.collection('parcel')
    const paymentCollection = db.collection('payments')
    // Users Collection
    app.get('/users', async(req,res)=>{
      const cursor =  usersCollection.find();
      const result = await cursor.toArray();
      res.send(result)
    })
    app.post('/users', async(req,res)=>{
      const user = req.body;
      user.role = 'user';
      const email = user.email
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      const userExists = await usersCollection.findOne({email})
      if(userExists){
       return res.send({message : 'Already Exists'})
      }
      res.send(result)
    })
    app.patch('/users/:id', async(req,res)=>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)}
      const userRole = req.body;
      const updateInfo = {
        $set : {
          role : userRole.role
        }
      }
      const result = await usersCollection.updateOne(query,updateInfo);
      res.send(result)
    })
    // app.get('/users', async(req,res)=>{
    //   const query = {};
    //   const cursor = usersCollection.find(query);
    //   const result = await cursor.toArray();
    //   res.send(result)
    // })
     // Riders Collection

     app.get('/riders', async(req,res)=>{
      const query = {};
      if(req.query.status){
        query.status = req.query.status
      }
      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result)
     })
     app.post('/riders', async(req,res)=>{
      const rider = req.body;
      rider.status = 'pending';
      rider.createdAt = new Date();
      const result = await ridersCollection.insertOne(rider)
      res.send(result)
     })

     app.patch('/riders/:id', async(req,res)=>{
      const status = req.body.status;
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const updatedDoc = {
        $set: {
          status: status
        }
      }
      const result = await ridersCollection.updateOne(query,updatedDoc);
      if(status === 'approved'){
        const email = req.body.email;
        const userQuery = {email};
        const updateUser ={
          $set: {
            role : 'rider'
          }
        }
        const userResult = await usersCollection.updateOne(userQuery,updateUser);
        console.log('udated role', userResult)
      }
      
      res.send(result)
     })

     app.delete('/riders/:id', async(req,res)=>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)};
      const result = await ridersCollection.deleteOne(query);
      res.send(result)
     })
// Parcels Collection 
    app.get('/parcels', async(req,res)=>{
        const query = {};
        const {email} = req.query;
        console.log("Email received:", email);
        if(email){
            query.SenderEmail = email
        }
        const options = {sort : {createdAt : -1}}
        const cursor = parcelsCollection.find(query,options);
        const result = await cursor.toArray();
        res.send(result)
    })
    app.get('/parcels/:id', async(req,res)=>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await parcelsCollection.findOne(query);
      res.send(result)
    })
    app.post('/parcels', async(req,res)=>{
        const parcel = req.body;
        parcel.createdAt = new Date()
        const result = await parcelsCollection.insertOne(parcel);
        res.send(result)
    })


    app.delete('/parcels/:id', async(req,res)=>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)}
      const result = await parcelsCollection.deleteOne(query)
      res.send(result)
    })

    // STRIPE Payment Methood

    // app.post('/create-checkout-session', async(req,res)=>{
    //   const paymentInfo = req.body
    //   const amount = parseInt(paymentInfo.cost )* 100; 
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //   {
    //     // Provide the exact Price ID (for example, price_1234) of the product you want to sell
    //     // price_data: {
    //     //   currency: 'USD',
    //     //   unit_amount: 1500,
    //     //   product_data: {
    //     //     name: paymentInfo.parcelName
    //     //   }
    //     // },
    //     price_data: {
    //       currency: 'USD',
    //       unit_amount: amount,
    //       product_data: {
    //         name: paymentInfo.parcelName
    //       }
    //     },
    //     quantity: 1,
    //   },
    // ],
    // customer_email: paymentInfo.senderEmail,
    // mode: 'payment',
    // metadata: {
    //   parcelId: paymentInfo.parcelId
    // },
    // success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    // cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
  
    //   })
    //   console.log(session)
    //   res.send({url : session.url})
    // })
    app.post('/create-checkout-session', async(req,res)=>{
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
        price_data: {
          currency: 'USD',
          unit_amount: amount,
          product_data: {
            name: `Please Pay for ${paymentInfo.parcelName}` 
          }
        },
        quantity: 1,
      },
    ],
    customer_email: paymentInfo.senderEmail,
    mode: 'payment',
    metadata: {
      parcelId : paymentInfo.parcelId,
      parcelName: paymentInfo.parcelName
    },
    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    
  });
  res.send({url : session.url})
    })
    app.patch('/payment-success', async(req,res)=>{
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session)
      const transactionId = session.payment_intent;
      const query = {transactionId : transactionId};
      const paymentExist = await paymentCollection.findOne(query);
      if(paymentExist){
        return res.send({message: 'already exist', transactionId, trackingId: paymentExist.trackingId})
      }
      const trackingId = generateTrackingId()
      if(session.payment_status === 'paid'){
        const id = session.metadata.parcelId;
        const query = {_id : new ObjectId(id)};
        const update = {
          $set: {
            paymentStatus: 'paid',
            trackingId: trackingId
          }
        }
        const result = await parcelsCollection.updateOne(query,update);
        const payment = {
          amount : session.amount_total/100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId
        }
        if(session.payment_status === 'paid'){
          const resultPayment = await paymentCollection.insertOne(payment)
          res.send({success: true, trackingId: trackingId, transactionId: session.payment_intent, modifyParcel: result, paymentInfo: resultPayment})
        }
        res.send(result)
      }
      res.send({success: false})
    })
    // Payment relted CRUD
    app.get('/payments', verifyFBToken, async(req,res)=>{
      const email = req.query.email;
      const query = {};
      if(email){
        query.customerEmail = email;
        if(email !== req.decoded_email){
          return res.status(403).send({message: 'Forbidden access'})
        }
      }
      const cursor = paymentCollection.find(query).sort({paidAt: -1});
      const result  = await cursor.toArray();
      res.send(result)
    })
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})