# Entropic QOI

I love QOI image compression.
Its creator started by saying, hey this looks simple and fun.
And it was.
I've had similar thoughts, and QUI is inspiring me to do something.

I like the basic ideas of QOI, but I want to make one major change.
I want to add an entropy encoder to the output.
I think that would be a perfect complement to what QOI already has.

Is this expensive?
Is this slow?
Yes, but we'll see.
The entropy encoder I like is very fast, obsessively so.
The trick is to give the entropy encoder good data, specifically the current frequency distribution.

I've never optimized that code very well.
There are all sorts of tricks that I could pull to optimize my code.
But it's never been important because my prototypes have never been that interesting.

I mostly focus on a fake / simulated entropy encoder.
I've found that my favorite entropy decoder gives results very close to the ideal.
I focus on the probability of the item that is being chosen.
That's all that's required to estimate the cost of the operation, the size of the output.
To finish this I'd need to compute the probability of all of the items listed before the item I want to encode.
And that table will probably change over time.

We have a lot of options.
It is possible that we can make a fixed table of probabilities.
Usually I build the table continuously over time.
But I've never done a head to head comparison, so I don't know how that compares to a fixed table.
I need to collect a lot of data.

The basics of QOI is focused on one idea.
(This is _my_ summary, _my_ interpretation.)
When you compare each pixel to the one immediately before it, the result will typically be small.
Accordingly we have three formats for storing a pixel.
Very small changes will all fit into a one byte record.
Slightly larger changes will all fit into a two byte record.
And if that fails you add a one byte header to the original 3 or 4 byte pixel (r, g, b and maybe alpha).
So the most common case saves a lot, the moderately common case saves some, and the less common but required cases actually cost more.
**This immediately makes me think about entropy encoding.**

This is what entropy encoding does!
You tell it how common things are, it and finds an efficient way to encode each of those things.
Crudely speaking, more common things get shorter encodings.
But this can be so much more precise.
Why is QOI limited to those 3 formats?
(And why does green sometimes get more bits than red and blue?)
Maybe a continuous curve describes the frequency of each number we want to encode.
Or, since we only care about 256(ish) entries, maybe we have a table with the _exact_ frequency of each of the 256 values.

**Exact**.
That makes me feel good.
I provide data to my library as a rational number.
This works very well when I can count the actual number of items.
I can say that I've seen 5,019 different values so far,
and 22 of them were the one we wanted to encode,
so the probability of this item is 22 / 5,019.

Eventually the fraction is converted to an integer divided by 2^30.

A brief aside.
If you are familiar with Huffman coding, we are accomplishing the same thing, but in a much more precise way.
A quick mind blower, Huffman always requires at least one bit per input symbol.
I do not have those limitations.
A precision of 1 / 2^30, or 1 / 1,073,741,824, is more than sufficient for most things.
And there are tricks to extend that, but I can't believe we'll need any of them today.

My proposal is to split the file into 3 or 4 color channels, and compress each one separately.
This makes it easy for me to focus on the size of the change.
Maybe you are making small changes to the red while making large changes to the blue and none to the green.

When you subtract one value from the next you get a result between -255 and 255.
You could cheat and wrap around.
If one transition is from 0 to 255, and another is from 1 to 0, do we put those in the same bin?
Generally I don't, but if we're focus on speed an simplicity, we could consider that rule:
We're not focused on (a - b), but on (a - b) % 256.
I don't like it, but it's worth exploring.

So, for the most part we are just sending a list of numbers to the entropy encoder, values between 0 and 255.
If our numbers are clustered, if a few numbers are very common and some never appear, we can do a good job of compressing the list.
If they are spread randomly, our results will approach that of just writing the bytes out directly.

QOI had two other tricks: Caching recent values and RLE (run length encoding).
When dealing with an entropy encoder I'm cautious about having multiple ways to get to the same value.
That adds redundancy and takes from the value of the entropy encoder.

Regarding the RLE, I'll need to perform some tests.
Based on past experience I'd say that it can help for very long runs.
If we get three of the same value in a row, it's very possible that those were already common values with inexpensive encodings.
If we get 300 or 3000 of the same thing in a row, that different.
RLE can be very efficient with very large values.

And the idea of caching recent values.
I've had a lot of experience with recently used values.
They are usually expensive.
I can't really do anything exactly like the QUI cache.
That can hold up to 64 values but is one way associative.
I'm talking about encoding single bytes at a time, and remembering the last 64 bytes doesn't have the same appeal as remembering the last 64 pixels.
I see only one way to adapt this.

The idea is that certain pixel values might be common on their own, regardless of their neighbor's values.
That's something I can easily map to an entropy encoder.
Each time I see a byte, I add the difference between that byte and the previous byte to one table.
And I add the byte itself to another table.

How do I combine these two tables?
There are lots of options.
One would be to ask if one table yielded noticeably lower cost.
Then use that table and ignore the other.

Maybe we can combine the two tables to get more value out of them.
Something simple like (a _ the first probability + b _ the second probability) / (a + b).
So we would have a more precise estimate of the probability of each value.

Of course, if either table contains 0s, then we can remove those values from consideration.
If both tables contain some 0s, the zero's won't always line up the same way, and we can remove things from consideration if either value is 0.

You could try multiplying the two separate probabilities.
If the two variables, the absolute value and the relative value, are independent, then this is exactly the right answer.
But I don't know how well this works in other cases.
This will automatically take care of the 0 values.

This covers _common_ values.
But I haven't discussed _recent_ values.
The QUI cache automatically throws out old values.
Is that good or bad?
I have the option of making one single collection of statistics for the entire file.
Or of updating that over time, maybe explicitly blocks that I create in the compressor by calling reset().
Or maybe we keep continuous statistic as we go, and we exponentially ignore more and more of the old stuff as new stuff comes in.

Let's start from the simple case:
One set of statistics for the entire file.
Make one pass to collect the statistics.
Then a second pass to encode everything.

## TODO first version

Create a canvas.
Load it with a picture.
Start with the QOI reference images.
Include an interface to load a local file or an arbitrary url.

Create a way to accumulate a map, how many times each number has been used.
Focus on the 0-255 actual values and -255 to +255 relative values.
We can deal with % 256 values later if we want.
Need to **display** a histogram where each of the values is very clear, even if the counts are rounded to display well.
It should not be hard to fit 511 columns across on my screen.
Need to know how many zeros in each table.
I need to know the cost of encoding with just that one table.

Then two more experiments.
(The cost of the one table + the other) / 2
Multiplying the probabilities of each table.
Maybe consider something dealing with the 0's only if we see a lot of 0's first.

## RLE

Presumably the RLE only makes sense for absolute values, not relative values.
I said I only cared when the repeat count is very big.
The biggest it could be for the relative counter would be 255.
It's worth taking some statistics to see what these long values look like.

## Processing

Can I access 16 bit floating point color values from the canvas?
