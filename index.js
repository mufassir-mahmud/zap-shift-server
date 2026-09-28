const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const crypto = require('crypto');
const admin = require('firebase-admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express();

const port = process.env.PORT || 3000;


// ===============================
// Firebase Admin
// ===============================

const decoded = Buffer.from(
  process.env.FB_SERVICE_KEY,
  'base64'
).toString('utf8');

const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// ===============================
// Middleware
// ===============================

app.use(express.json());
app.use(cors());


// ===============================
// Root Route
// ===============================

app.get('/', (req, res) => {
  res.send('Hello World!');
});


// ===============================
// Firebase Token Verification
// ===============================

const verifyFBToken = async (req, res, next) => {
  console.log(
    'Headers in middleware:',
    req.headers.authorization
  );

  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({
      message: 'unauthorized access'
    });
  }

  try {
    const idToken = token.split(' ')[1];

    const decoded = await admin
      .auth()
      .verifyIdToken(idToken);

    console.log('Decoded ID token:', decoded);

    req.decoded_email = decoded.email;

    next();
  } catch (err) {
    console.log('Firebase token error:', err.message);

    return res.status(401).send({
      message: 'unauthorized access'
    });
  }
};


// ===============================
// MongoDB
// ===============================

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gbbfjrz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});


// ===============================
// Tracking ID Generator
// ===============================

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


// ===============================
// MongoDB Initialization
// ===============================

async function run() {
  try {
    await client.connect();

    console.log('MongoDB connected successfully');

    const db = client.db('zap-shif-client');

    const usersCollection = db.collection('users');
    const ridersCollection = db.collection('riders');
    const parcelsCollection = db.collection('parcel');
    const paymentCollection = db.collection('payments');
    const trackingCollection = db.collection('trackings');


    // ===============================
    // Admin Verification
    // ===============================

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;

      const query = { email };

      const user = await usersCollection.findOne(query);

      if (user?.role !== 'admin') {
        return res.status(403).send({
          message: 'forbidden access'
        });
      }

      next();
    };


    // ===============================
    // Tracking Log
    // ===============================

    const logTracking = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        details: status.split('-').join(' '),
        createdAt: new Date()
      };

      const result = await trackingCollection.insertOne(log);

      return result;
    };


    // =========================================================
    // USERS
    // =========================================================

    // Get users
    app.get('/users', verifyFBToken, async (req, res) => {
      try {
        const searchText = req.query.searchText;

        const query = {};

        if (searchText) {
          query.$or = [
            {
              displayName: {
                $regex: searchText,
                $options: 'i'
              }
            },
            {
              email: {
                $regex: searchText,
                $options: 'i'
              }
            }
          ];
        }

        const cursor = usersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(5);

        const result = await cursor.toArray();

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to get users'
        });
      }
    });


    // Get user by ID
    app.get('/users/:id', async (req, res) => {
      try {
        const id = req.params.id;

        const query = {
          _id: new ObjectId(id)
        };

        const result = await usersCollection.findOne(query);

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to get user'
        });
      }
    });


    // Get user role
    app.get('/users/:email/role', async (req, res) => {
      try {
        const email = req.params.email;

        const query = { email };

        const user = await usersCollection.findOne(query);

        res.send({
          role: user?.role || 'user'
        });
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to get user role'
        });
      }
    });


    // Create user
    app.post('/users', async (req, res) => {
      try {
        const user = req.body;

        const email = user.email;

        // Check first before inserting
        const userExists = await usersCollection.findOne({
          email
        });

        if (userExists) {
          return res.send({
            message: 'Already Exists'
          });
        }

        user.role = 'user';
        user.createdAt = new Date();

        const result = await usersCollection.insertOne(user);

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to create user'
        });
      }
    });


    // Update user role
    app.patch(
      '/users/:id/role',
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;

          const query = {
            _id: new ObjectId(id)
          };

          const userRole = req.body;

          const updateInfo = {
            $set: {
              role: userRole.role
            }
          };

          const result = await usersCollection.updateOne(
            query,
            updateInfo
          );

          res.send(result);
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message: 'Failed to update user role'
          });
        }
      }
    );


    // =========================================================
    // RIDERS
    // =========================================================

    // Get riders
    app.get('/riders', async (req, res) => {
      try {
        const {
          status,
          district,
          workStatus
        } = req.query;

        console.log('STATUS:', status);
        console.log('DISTRICT:', district);
        console.log('WORK STATUS:', workStatus);

        const query = {};

        if (status) {
          query.status = status;
        }

        if (district) {
          query.RiderDistrict = district;
        }

        if (workStatus) {
          query.workStatus = workStatus;
        }

        console.log('QUERY:', query);

        const result = await ridersCollection
          .find(query)
          .toArray();

        console.log('RESULT:', result);

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to get riders'
        });
      }
    });


    // Rider delivery per day
    app.get('/riders/delivery-per-day', async (req, res) => {
      try {
        const email = req.query.email;

        const pipeline = [
          {
            $match: {
              riderEmail: email,
              deliveryStatus: 'parcel-delivered'
            }
          }
        ];

        const result = await parcelsCollection
          .aggregate(pipeline)
          .toArray();

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to get rider delivery data'
        });
      }
    });


    // Create rider
    app.post('/riders', async (req, res) => {
      try {
        const rider = req.body;

        rider.status = 'pending';
        rider.createdAt = new Date();

        const result = await ridersCollection.insertOne(rider);

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to create rider'
        });
      }
    });


    // Approve / Reject rider
    app.patch(
      '/riders/:id',
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const status = req.body.status;
          const id = req.params.id;

          const query = {
            _id: new ObjectId(id)
          };

          const updatedDoc = {
            $set: {
              status: status
            }
          };


          if (status === 'approved') {
            updatedDoc.$set.workStatus = 'available';
          }


          if (status === 'rejected') {
            updatedDoc.$set.workStatus = 'unavailable';
          }


          const result = await ridersCollection.updateOne(
            query,
            updatedDoc
          );


          // When approved, make the user a rider
          if (status === 'approved') {
            const email = req.body.email;

            const userQuery = {
              email
            };

            const updateUser = {
              $set: {
                role: 'rider'
              }
            };

            const userResult = await usersCollection.updateOne(
              userQuery,
              updateUser
            );

            console.log(
              'Updated user role:',
              userResult
            );
          }


          res.send(result);
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message: 'Failed to update rider'
          });
        }
      }
    );


    // Delete rider
    app.delete('/riders/:id', async (req, res) => {
      try {
        const id = req.params.id;

        const query = {
          _id: new ObjectId(id)
        };

        const result = await ridersCollection.deleteOne(
          query
        );

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to delete rider'
        });
      }
    });


    // =========================================================
    // PARCELS
    // =========================================================

    // Get parcels
    app.get('/parcels', async (req, res) => {
      try {
        const query = {};

        const {
          email,
          deliveryStatus
        } = req.query;

        console.log(
          'Email received:',
          email
        );

        if (email) {
          query.SenderEmail = email;
        }

        if (deliveryStatus) {
          query.deliveryStatus = deliveryStatus;
        }

        const options = {
          sort: {
            createdAt: -1
          }
        };

        const cursor = parcelsCollection.find(
          query,
          options
        );

        const result = await cursor.toArray();

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to get parcels'
        });
      }
    });


    // Get rider parcels
    app.get('/parcels/rider', async (req, res) => {
      try {
        const {
          riderEmail,
          deliveryStatus
        } = req.query;

        const query = {};

        if (riderEmail) {
          query.riderEmail = riderEmail;
        }


        if (deliveryStatus !== 'parcel-delivered') {
          query.deliveryStatus = {
            $nin: ['parcel-delivered']
          };
        } else {
          // FIXED
          query.deliveryStatus = deliveryStatus;
        }


        const cursor = parcelsCollection.find(query);

        const result = await cursor.toArray();

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to get rider parcels'
        });
      }
    });


    // Get parcel by ID
    app.get('/parcels/:id', async (req, res) => {
      try {
        const id = req.params.id;

        const query = {
          _id: new ObjectId(id)
        };

        const result = await parcelsCollection.findOne(query);

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to get parcel'
        });
      }
    });


    // Parcel delivery status statistics
    app.get(
      '/parcels/delivery-status/stats',
      async (req, res) => {
        try {
          const pipeline = [
            {
              $group: {
                _id: '$deliveryStatus',
                count: {
                  $sum: 1
                }
              }
            },
            {
              $project: {
                status: '$_id',
                count: 1,
                _id: 0
              }
            }
          ];

          const result = await parcelsCollection
            .aggregate(pipeline)
            .toArray();

          res.send(result);
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message: 'Failed to get delivery statistics'
          });
        }
      }
    );


    // Create parcel
    app.post('/parcels', async (req, res) => {
      try {
        const parcel = req.body;

        const trackingId = generateTrackingId();

        parcel.createdAt = new Date();
        parcel.trackingId = trackingId;

        await logTracking(
          trackingId,
          'parcel-created'
        );

        const result = await parcelsCollection.insertOne(
          parcel
        );

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to create parcel'
        });
      }
    });


    // Assign rider to parcel
    app.patch('/parcels/:id', async (req, res) => {
      try {
        const {
          riderId,
          riderName,
          riderEmail,
          trackingId
        } = req.body;

        const id = req.params.id;

        const query = {
          _id: new ObjectId(id)
        };

        const updatedDoc = {
          $set: {
            deliveryStatus: 'driver-assigned',
            riderId: riderId,
            riderEmail: riderEmail,
            riderName: riderName
          }
        };

        const result = await parcelsCollection.updateOne(
          query,
          updatedDoc
        );


        // Update rider work status
        const riderQuery = {
          _id: new ObjectId(riderId)
        };

        const riderUpdatedDoc = {
          $set: {
            workStatus: 'in-delivery'
          }
        };

        const riderResult = await ridersCollection.updateOne(
          riderQuery,
          riderUpdatedDoc
        );


        await logTracking(
          trackingId,
          'driver-assigned'
        );


        res.send({
          parcelResult: result,
          riderResult: riderResult
        });
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to assign rider'
        });
      }
    });


    // Update parcel delivery status
    app.patch(
      '/parcels/:id/status',
      async (req, res) => {
        try {
          const {
            deliveryStatus,
            riderId,
            trackingId
          } = req.body;

          const query = {
            _id: new ObjectId(req.params.id)
          };

          const updatedInfo = {
            $set: {
              deliveryStatus: deliveryStatus
            }
          };


          // If delivered, make rider available again
          if (deliveryStatus === 'parcel-delivered') {
            const riderQuery = {
              _id: new ObjectId(riderId)
            };

            const riderUpdatedDoc = {
              $set: {
                workStatus: 'available'
              }
            };

            await ridersCollection.updateOne(
              riderQuery,
              riderUpdatedDoc
            );
          }


          const result = await parcelsCollection.updateOne(
            query,
            updatedInfo
          );


          await logTracking(
            trackingId,
            deliveryStatus
          );


          res.send(result);
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message: 'Failed to update parcel status'
          });
        }
      }
    );


    // Delete parcel
    app.delete('/parcels/:id', async (req, res) => {
      try {
        const id = req.params.id;

        const query = {
          _id: new ObjectId(id)
        };

        const result = await parcelsCollection.deleteOne(
          query
        );

        res.send(result);
      } catch (error) {
        console.log(error);

        res.status(500).send({
          message: 'Failed to delete parcel'
        });
      }
    });


    // =========================================================
    // STRIPE
    // =========================================================

    // Create Stripe checkout session
    app.post(
      '/create-checkout-session',
      async (req, res) => {
        try {
          const paymentInfo = req.body;

          console.log(
            'Payment Info:',
            paymentInfo
          );

          const amount =
            parseInt(paymentInfo.cost) * 100;


          if (!paymentInfo.cost || isNaN(amount)) {
            return res.status(400).send({
              message: 'Invalid payment amount'
            });
          }


          const session =
            await stripe.checkout.sessions.create({
              line_items: [
                {
                  price_data: {
                    currency: 'USD',
                    unit_amount: amount,

                    product_data: {
                      name: `Please Pay for ${paymentInfo.parcelName}`
                    }
                  },

                  quantity: 1
                }
              ],

              customer_email:
                paymentInfo.senderEmail,

              mode: 'payment',

              metadata: {
                parcelId:
                  paymentInfo.parcelId,

                parcelName:
                  paymentInfo.parcelName,

                trackingId:
                  paymentInfo.trackingId
              },

              success_url:
                `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,

              cancel_url:
                `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`
            });


          res.send({
            url: session.url
          });
        } catch (error) {
          console.log(
            'STRIPE ERROR:',
            error.message
          );

          res.status(400).send({
            message: error.message
          });
        }
      }
    );


    // Payment success
    app.patch(
      '/payment-success',
      async (req, res) => {
        try {
          const sessionId =
            req.query.session_id;

          const session =
            await stripe.checkout.sessions.retrieve(
              sessionId
            );

          console.log(session);


          const transactionId =
            session.payment_intent;

          const query = {
            transactionId:
              transactionId
          };


          const paymentExist =
            await paymentCollection.findOne(
              query
            );


          if (paymentExist) {
            return res.send({
              message: 'already exist',

              transactionId:
                transactionId,

              trackingId:
                paymentExist.trackingId
            });
          }


          const trackingId =
            session.metadata.trackingId;


          if (
            session.payment_status === 'paid'
          ) {
            const id =
              session.metadata.parcelId;


            const parcelQuery = {
              _id: new ObjectId(id)
            };


            const update = {
              $set: {
                paymentStatus: 'paid',
                deliveryStatus: 'pending-pickup',
                trackingId: trackingId
              }
            };


            const result =
              await parcelsCollection.updateOne(
                parcelQuery,
                update
              );


            const payment = {
              amount:
                session.amount_total / 100,

              currency:
                session.currency,

              customerEmail:
                session.customer_email,

              parcelId:
                session.metadata.parcelId,

              parcelName:
                session.metadata.parcelName,

              transactionId:
                session.payment_intent,

              paymentStatus:
                session.payment_status,

              paidAt:
                new Date(),

              trackingId:
                trackingId
            };


            const resultPayment =
              await paymentCollection.insertOne(
                payment
              );


            await logTracking(
              trackingId,
              'pending-pickup'
            );


            return res.send({
              success: true,

              trackingId:
                trackingId,

              transactionId:
                session.payment_intent,

              modifyParcel:
                result,

              paymentInfo:
                resultPayment
            });
          }


          return res.send({
            success: false
          });
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message:
              'Payment success processing failed'
          });
        }
      }
    );


    // =========================================================
    // PAYMENTS
    // =========================================================

    app.get(
      '/payments',
      verifyFBToken,
      async (req, res) => {
        try {
          const email = req.query.email;

          const query = {};

          if (email) {
            query.customerEmail = email;

            if (
              email !== req.decoded_email
            ) {
              return res.status(403).send({
                message:
                  'Forbidden access'
              });
            }
          }


          const cursor =
            paymentCollection
              .find(query)
              .sort({
                paidAt: -1
              });


          const result =
            await cursor.toArray();


          res.send(result);
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message:
              'Failed to get payments'
          });
        }
      }
    );


    // =========================================================
    // TRACKING
    // =========================================================

    app.get(
      '/trackings/:trackingId/logs',
      async (req, res) => {
        try {
          const trackingId =
            req.params.trackingId;

          const query = {
            trackingId
          };


          const result =
            await trackingCollection
              .find(query)
              .sort({
                createdAt: 1
              })
              .toArray();


          res.send(result);
        } catch (error) {
          console.log(error);

          res.status(500).send({
            message:
              'Failed to get tracking logs'
          });
        }
      }
    );


    console.log(
      'All API routes registered successfully'
    );
  } catch (error) {
    console.log(
      'MongoDB initialization error:',
      error
    );

    throw error;
  }
}


// =========================================================
// IMPORTANT FOR VERCEL
// =========================================================
//
// Start MongoDB initialization immediately.
// The API middleware below waits for this to finish
// before allowing requests to reach the API routes.
//

const initPromise = run();


// =========================================================
// Wait for MongoDB initialization
// =========================================================

app.use(async (req, res, next) => {
  try {
    await initPromise;

    next();
  } catch (error) {
    console.log(
      'Database initialization failed:',
      error
    );

    res.status(500).send({
      message:
        'Database initialization failed'
    });
  }
});


// =========================================================
// Local Development
// =========================================================
//
// Vercel does NOT need app.listen().
// Local development still uses it.
//

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(
      `Example app listening on port ${port}`
    );
  });
}


// =========================================================
// Export Express App for Vercel
// =========================================================

module.exports = app;