# CookingWithNode

Node micro-app to display wireless meat thermometer data.  It currently works
with the base from this meat thermometer:

![MeatThermometer1](https://raw.githubusercontent.com/mhdawson/PI433WirelessRecvManager/master/pictures/MeatThermometer1.jpg)

using this project: [PI433WirelessRecvManager](https://github.com/mhdawson/PI433WirelessRecvManager).

You can get these for around $20 from Amazon and ebay.  I've ordered a couple
of additional ones from different buyers to validate that all of the ones
that look like this use the same protocol
and will confirm that once I receive them.

The micro-app starts with a blank page indicating that it is listening for
probes:

![ListeningForProbes](https://raw.githubusercontent.com/mhdawson/CookingWithNode/master/pictures/CookingWithNodeWaitingPC.png)

Once you turn on the probe it will show up in the display:

![CookingWithNodeProbe1PC](https://raw.githubusercontent.com/mhdawson/CookingWithNode/master/pictures/CookingWithNodeProbe1PC.png)

The micro-app supports multiple probes, so as you turn on addiitonal
probes the display for each additional probe will show up under the
previous probes. It is possible that the probe base will chose the
same probe id an existing one, in which case you'll need to turn it
off for 10-20 seconds and turn it back on. Most likely the base will
pick another id.  Once I get additional probes I'll see how often
conflicts occur.

Using this project [micro-app-cordova-launcher](https://github.com/mhdawson/micro-app-cordova-launcher) you can build a native application for your phone which displays nicely as
well:

![ListeningForProbes](https://raw.githubusercontent.com/mhdawson/CookingWithNode/master/pictures/CookingWithNodeWaitingPhone.png)


![CookingWithNodeProbe1PC](https://raw.githubusercontent.com/mhdawson/CookingWithNode/master/pictures/CookingWithNodeProbe1Phone.png)

The UI allows you to select the meat that you are cooking as well as the target "doneness" depending on the meat.

**NOTE: this application is to be used only as a convenience in addtion to the
original display.  Always validate that your meat has reached the required
target temperature with the original meat thermometer display before serving.**

As the meat cooks the display will update, showing the current
temperature as reported by the probe, as well as a graph of the cook
so far.  

For example, in this cook I selected pork, with a target of medium
for "doneness" and probe 44 shows that the target temperature is
160 degress Farenheit.  The current probe temperature is 96 degress
Farenheit and you can see the graph of the cook progression in the
lower right hand corner.

![CookingWithNodeProbe1PC](https://raw.githubusercontent.com/mhdawson/CookingWithNode/master/pictures/CookingWithNodeProbe1PC98.png)

You can change between showing temperatures in Celcius and Farenheit by
selecting the 'C' or 'F' buttons.

Once the cook progresses and is "warn" degrees (~10 degrees Farenheit by
default) from the target temperature,
the probe will change to the warning color, and if you have configured sms
notificaitons an sms text will be sent to your phone.

In addition, the configured "warn" message wil start playing.  You can
silence the warning message by clicking the "mute" button.

![CookingWithNodeProbe1PC](https://raw.githubusercontent.com/mhdawson/CookingWithNode/master/pictures/CookingWithNodeProbe1PC151.png)

This process is repeated as the probe reaches the target temperature,
with the probe changing to the target temperature coloar and another
sms message being sent if so configured. In addition, the configured
"target" message will start playing.  You can silence the target
message by clicking the "mute" button.

![CookingWithNodeProbe1PC](https://raw.githubusercontent.com/mhdawson/CookingWithNode/master/pictures/CookingWithNodeProbe1PC160.png)

Once complete and you turn off the probe, the probe will drop off
the display after a few minutes and if it was the last probe the
display will go back to displaying the original waiting
for probes messsage.

# Configuration



# Installation

The easiest way to install is to run:

```
npm install cooking-with-node
```

or

```
npm install https://github.com/mhdawson/CookingWithNode
```

and then configure the default config.json file in the lib directory
as described in the configuration section above.

# Running

Simply cd to the directory where the npm was installed and type:

```
npm start
```
